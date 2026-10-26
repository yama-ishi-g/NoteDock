import { unzipSync, zipSync, type Zippable } from 'fflate'
import { inkPath, migrateInk, migrateNote, newHandwritingNote, NOTE_EXT, NOTE_JSON, type InkData, type NoteDoc } from '../formats/notedock'
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

/** 新しい手書きノート（手書きブロック1つの .notedock）を作る */
export async function createHandwritingNote(projectId: string, parent: string, name: string): Promise<string> {
  const fileName = withNoteExt(name)
  const error = validateName(fileName)
  if (error) throw new AppError(error)
  const path = joinPath(parent, await availableName(projectId, parent, fileName))
  const note = newHandwritingNote()
  const storage = getStorage()
  await storage.writeJson(abs(projectId, path, NOTE_JSON), note)
  for (const b of note.blocks) if (b.type === 'ink') await storage.writeJson(abs(projectId, path, inkPath(b.id)), { formatVersion: 1, strokes: [] } satisfies InkData)
  await touchProject(projectId)
  return path
}

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

/** note.json から参照されない ink/*.json を削除する */
export async function cleanupNote(projectId: string, notePath: string, note: NoteDoc): Promise<void> {
  const storage = getStorage()
  const used = new Set(note.blocks.filter((b) => b.type === 'ink').map((b) => `${b.id}.json`))
  try {
    for (const e of await storage.listDir(abs(projectId, notePath, 'ink'))) {
      if (e.kind === 'file' && !used.has(e.name) && !e.name.endsWith(TMP_SUFFIX)) await storage.remove(abs(projectId, notePath, `ink/${e.name}`))
    }
  } catch {
    // ink フォルダがない
  }
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
