import { unzipSync, zipSync, type Zippable } from 'fflate'
import { inkPath, migrateInk, migrateNote, newHandwritingNote, newMixedNote, NOTE_EXT, NOTE_JSON, type ImageBlock, type InkData, type NoteDoc } from '../formats/notedock'
import { prepareImage } from '../io/images'
import { projectFilesDir } from '../formats/project'
import { roundStroke, type Stroke } from '../ink/model'
import { getStorage } from '../storage'
import { extname, joinPath, TMP_SUFFIX, validateName } from '../storage/paths'
import { toBytes } from '../storage/StorageService'
import { availableName } from './files'
import { AppError, touchProject } from './projects'

const abs = (projectId: string, notePath: string, inner = '') => joinPath(projectFilesDir(projectId), notePath, inner)

export function withNoteExt(name: string) {
  return extname(name) === NOTE_EXT ? name : `${name}.${NOTE_EXT}`
}

/** 新しいノートを作る。kind: handwriting = 手書きブロック1つ、mixed = 文章から始まる混在ノート */
export async function createNote(projectId: string, parent: string, name: string, kind: 'handwriting' | 'mixed'): Promise<string> {
  const fileName = withNoteExt(name)
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

export async function loadInk(projectId: string, notePath: string, blockId: string): Promise<Stroke[]> {
  try {
    return migrateInk(await getStorage().readJson(abs(projectId, notePath, inkPath(blockId)))).strokes
  } catch {
    return []
  }
}

export async function saveInk(projectId: string, notePath: string, blockId: string, strokes: Stroke[]): Promise<void> {
  const data: InkData = { formatVersion: 1, strokes: strokes.map(roundStroke) }
  // 1本描くたびにノート全体を書き直さないよう、手書きブロックごとに別ファイルにする
  await getStorage().writeFile(abs(projectId, notePath, inkPath(blockId)), JSON.stringify(data))
}

/** note.json から参照されない ink/*.json と images/* を削除する */
export async function cleanupNote(projectId: string, notePath: string, note: NoteDoc): Promise<void> {
  const storage = getStorage()
  const usedInk = new Set(note.blocks.filter((b) => b.type === 'ink').map((b) => `${b.id}.json`))
  const usedImages = new Set(note.blocks.filter((b): b is ImageBlock => b.type === 'image').flatMap((b) => {
    const name = b.src.replace(/^images\//, '')
    return [name, `${name}.ink.json`]
  }))
  for (const [dir, used] of [['ink', usedInk], ['images', usedImages]] as const) {
    try {
      for (const e of await storage.listDir(abs(projectId, notePath, dir))) {
        if (e.kind === 'file' && !used.has(e.name) && !e.name.endsWith(TMP_SUFFIX)) await storage.remove(abs(projectId, notePath, `${dir}/${e.name}`))
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

/** ノートのフォルダの中身を ZIP にする（書き出し用の .notedock ファイル） */
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

/** .notedock（ZIP）を取り込み、ノートのフォルダとして展開する */
export async function importNoteZip(projectId: string, parent: string, name: string, bytes: Uint8Array): Promise<string> {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new AppError('ノートのファイルが壊れています')
  }
  const meta = files[NOTE_JSON]
  if (!meta) throw new AppError('ノートのファイルではありません（note.json がありません）')
  migrateNote(JSON.parse(new TextDecoder().decode(meta)))
  const path = joinPath(parent, await availableName(projectId, parent, withNoteExt(name)))
  const storage = getStorage()
  for (const [p, data] of Object.entries(files)) {
    if (p.endsWith('/') || p.split('/').some((s) => s === '..' || !s)) continue
    await storage.writeFile(abs(projectId, path, p), data)
  }
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
