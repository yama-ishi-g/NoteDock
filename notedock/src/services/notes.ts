import { unzipSync, zipSync, type Zippable } from 'fflate'
import {
  INK_NOTE_EXT, inkPath, isNoteExt, LEGACY_INK_NOTE_EXT, migrateInk, migrateNote, MIXED_NOTE_EXT, newHandwritingNote, newMixedNote, noteExtOf, noteKindOf, NOTE_JSON,
  type ImageBlock, type InkData, type NoteDoc, type NoteKind,
} from '../formats/notedock'
import { prepareImage } from '../io/images'
import { projectFilesDir } from '../formats/project'
import { ASSETS_SUFFIX, assetsDirOf } from '../ink/assets'
import type { InkItem } from '../ink/items'
import { roundStroke, type Stroke } from '../ink/model'
import { getStorage } from '../storage'
import { extname, joinPath, stem, TMP_SUFFIX, validateName } from '../storage/paths'
import { toBytes } from '../storage/StorageService'
import { availableName } from './files'
import { AppError, touchProject } from './projects'

const abs = (projectId: string, notePath: string, inner = '') => joinPath(projectFilesDir(projectId), notePath, inner)

/** ノートの拡張子（.mixdock / .notedock）が付いていなければ付ける */
export function withNoteExt(name: string, ext: string = MIXED_NOTE_EXT) {
  return isNoteExt(extname(name)) ? name : `${name}.${ext}`
}

/** 新しいノートを作る。kind: handwriting = 手書きブロック1つ、mixed = 文章から始まる混在ノート */
export async function createNote(projectId: string, parent: string, name: string, kind: 'handwriting' | 'mixed'): Promise<string> {
  const fileName = withNoteExt(name, noteExtOf(kind))
  const error = validateName(fileName)
  if (error) throw new AppError(error)
  const path = joinPath(parent, await availableName(projectId, parent, fileName))
  const note = kind === 'mixed' ? newMixedNote() : newHandwritingNote()
  const storage = getStorage()
  await storage.writeJson(abs(projectId, path, NOTE_JSON), note)
  for (const b of note.blocks) if (b.type === 'ink') await storage.writeJson(abs(projectId, path, inkPath(b.id)), { formatVersion: 1, strokes: [] } satisfies InkData)
  await touchProject(projectId)
  return path
}

export const createHandwritingNote = (projectId: string, parent: string, name: string) => createNote(projectId, parent, name, 'handwriting')

export async function loadNote(projectId: string, notePath: string): Promise<NoteDoc> {
  return migrateNote(await getStorage().readJson(abs(projectId, notePath, NOTE_JSON)))
}

export async function saveNote(projectId: string, notePath: string, note: NoteDoc): Promise<void> {
  await getStorage().writeJson(abs(projectId, notePath, NOTE_JSON), { ...note, updatedAt: new Date().toISOString() })
}

export async function loadInkData(projectId: string, notePath: string, blockId: string): Promise<{ strokes: Stroke[]; items: InkItem[] }> {
  try {
    const d = migrateInk(await getStorage().readJson(abs(projectId, notePath, inkPath(blockId))))
    return { strokes: d.strokes, items: d.items ?? [] }
  } catch {
    return { strokes: [], items: [] }
  }
}

export async function loadInk(projectId: string, notePath: string, blockId: string): Promise<Stroke[]> {
  return (await loadInkData(projectId, notePath, blockId)).strokes
}

export async function saveInk(projectId: string, notePath: string, blockId: string, strokes: Stroke[], items: InkItem[] = []): Promise<void> {
  const data: InkData = { formatVersion: 1, strokes: strokes.map(roundStroke), ...(items.length ? { items } : {}) }
  // 1本描くたびにノート全体を書き直さないよう、手書きブロックごとに別ファイルにする
  await getStorage().writeFile(abs(projectId, notePath, inkPath(blockId)), JSON.stringify(data))
}

/** note.json から参照されない ink/*.json と images/* を削除する */
export async function cleanupNote(projectId: string, notePath: string, note: NoteDoc): Promise<void> {
  const storage = getStorage()
  const usedInk = new Set(note.blocks.filter((b) => b.type === 'ink').map((b) => `${b.id}.json`))
  const usedImages = new Set(note.blocks.filter((b): b is ImageBlock => b.type === 'image').flatMap((b) => {
    const name = b.src.replace(/^images\//, '')
    return [name, `${name}.ink.json`, assetsDirOf(name)]
  }))
  // 手書きブロックに置いた画像も残す
  for (const b of note.blocks) {
    if (b.type !== 'ink') continue
    for (const item of (await loadInkData(projectId, notePath, b.id)).items) if (item.type === 'image') usedImages.add(item.src.replace(/^images\//, ''))
  }
  for (const [dir, used] of [['ink', usedInk], ['images', usedImages]] as const) {
    try {
      for (const e of await storage.listDir(abs(projectId, notePath, dir))) {
        // 画像ブロックに置いた画像のフォルダ（images/xxx.jpg.ink.assets）も、画像ブロックが無くなれば消す
        const stale = e.kind === 'file' ? !used.has(e.name) && !e.name.endsWith(TMP_SUFFIX) : e.name.endsWith(ASSETS_SUFFIX) && !used.has(e.name)
        if (stale) await storage.remove(abs(projectId, notePath, `${dir}/${e.name}`))
      }
    } catch {
      // フォルダがない
    }
  }
}

/** ノートに画像を追加する（HEIC は JPEG に変換、大きい画像は縮小）。ブロックを返す */
export async function addNoteImage(projectId: string, notePath: string, file: File): Promise<ImageBlock> {
  const prepared = await prepareImage(file)
  const ext = extname(prepared.name) || 'jpg'
  const id = crypto.randomUUID()
  const src = `images/${id}.${ext}`
  const bmp = await createImageBitmap(prepared.data)
  const block: ImageBlock = { id, type: 'image', src, width: bmp.width, height: bmp.height }
  bmp.close()
  await getStorage().writeFile(abs(projectId, notePath, src), prepared.data)
  return block
}

export async function readNoteFile(projectId: string, notePath: string, inner: string): Promise<File> {
  return getStorage().readFile(abs(projectId, notePath, inner))
}

/** ノートのフォルダの中身を ZIP にする（書き出し用の .mixdock / .notedock ファイル） */
export async function zipNote(projectId: string, notePath: string): Promise<Uint8Array> {
  const storage = getStorage()
  const entries: Zippable = {}
  const walk = async (rel: string) => {
    for (const e of await storage.listDir(abs(projectId, notePath, rel))) {
      const p = joinPath(rel, e.name)
      if (e.kind === 'dir') await walk(p)
      else if (!e.name.endsWith(TMP_SUFFIX)) entries[p] = await toBytes(await storage.readFile(abs(projectId, notePath, p)))
    }
  }
  await walk('')
  return zipSync(entries)
}

/** ノートの種類を、拡張子に合わせて note.json に書く（名前の変更で拡張子を付け替えたとき） */
export async function syncNoteKind(projectId: string, notePath: string): Promise<void> {
  const ext = extname(notePath).toLowerCase()
  const kind: NoteKind = ext === MIXED_NOTE_EXT ? 'mixed' : 'handwriting'
  const note = await loadNote(projectId, notePath)
  if (note.kind !== kind) await getStorage().writeJson(abs(projectId, notePath, NOTE_JSON), { ...note, kind })
}

/**
 * 以前の形式のノートを、今の拡張子にそろえる（プロジェクトを開くとき）。
 *   .inkdock（以前の開発版の手書きノート）→ .notedock
 *   kind のない .notedock（v1.0.0 まで）→ 中身で判定し、混在ノートなら .mixdock
 * 名前を変えたノートの [元のパス, 新しいパス] を返す
 */
export async function migrateNoteNames(projectId: string): Promise<[string, string][]> {
  const storage = getStorage()
  const renamed: [string, string][] = []
  const walk = async (dir: string) => {
    for (const e of await storage.listDir(abs(projectId, dir))) {
      if (e.kind !== 'dir') continue
      const path = joinPath(dir, e.name)
      const ext = extname(e.name).toLowerCase()
      if (!isNoteExt(ext)) {
        if (!e.name.endsWith(ASSETS_SUFFIX)) await walk(path)
        continue
      }
      if (ext === MIXED_NOTE_EXT) continue
      let note: NoteDoc
      try {
        note = await loadNote(projectId, path)
      } catch {
        continue
      }
      if (ext === INK_NOTE_EXT && note.kind) continue
      const kind = ext === LEGACY_INK_NOTE_EXT ? 'handwriting' : noteKindOf(note)
      await storage.writeJson(abs(projectId, path, NOTE_JSON), { ...note, kind })
      const want = noteExtOf(kind)
      if (want === ext) continue
      const to = joinPath(dir, await availableName(projectId, dir, `${stem(e.name)}.${want}`))
      await storage.move(abs(projectId, path), abs(projectId, to))
      renamed.push([path, to])
    }
  }
  await walk('')
  if (renamed.length) await touchProject(projectId)
  return renamed
}

/** .mixdock / .notedock（ZIP）を取り込み、ノートのフォルダとして展開する（以前の形式は今の拡張子にそろえる） */
export async function importNoteZip(projectId: string, parent: string, name: string, bytes: Uint8Array): Promise<string> {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new AppError('ノートのファイルが壊れています')
  }
  const meta = files[NOTE_JSON]
  if (!meta) throw new AppError('ノートのファイルではありません（note.json がありません）')
  const parsed = migrateNote(JSON.parse(new TextDecoder().decode(meta)))
  const ext = extname(name).toLowerCase()
  // 拡張子と種類を合わせる。.mixdock は混在ノート、kind のある .notedock は手書きノート、それ以外は中身で判定する
  const kind: NoteKind = ext === MIXED_NOTE_EXT ? 'mixed' : ext === INK_NOTE_EXT && parsed.kind ? 'handwriting' : ext === LEGACY_INK_NOTE_EXT ? 'handwriting' : noteKindOf(parsed)
  const fileName = isNoteExt(ext) ? `${stem(name)}.${noteExtOf(kind)}` : withNoteExt(name, noteExtOf(kind))
  const path = joinPath(parent, await availableName(projectId, parent, fileName))
  const storage = getStorage()
  for (const [p, data] of Object.entries(files)) {
    if (p.endsWith('/') || p.split('/').some((s) => s === '..' || !s)) continue
    await storage.writeFile(abs(projectId, path, p), data)
  }
  if (parsed.kind !== kind) await storage.writeJson(abs(projectId, path, NOTE_JSON), { ...parsed, kind })
  await touchProject(projectId)
  return path
}

/** ノートの中のファイルを複製する（画像ブロックの複製） */
export async function copyNoteFile(projectId: string, notePath: string, from: string, to: string): Promise<void> {
  const storage = getStorage()
  await storage.copy(abs(projectId, notePath, from), abs(projectId, notePath, to))
}

export async function noteFileExists(projectId: string, notePath: string, inner: string): Promise<boolean> {
  return getStorage().exists(abs(projectId, notePath, inner))
}
