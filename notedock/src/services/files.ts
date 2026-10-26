import { isNoteExt } from '../formats/notedock'
import { projectFilesDir } from '../formats/project'
import { getStorage } from '../storage'
import { ASSETS_SUFFIX, assetsDirOf } from '../ink/assets'
import { basename, dirname, extname, isSidecar, joinPath, sidecarOf, TMP_SUFFIX, uniqueName, validateName } from '../storage/paths'
import { AppError, touchProject } from './projects'

// プロジェクト内のパスは files/ からの相対パス（ルートは ''）

export type FileType = 'text' | 'markdown' | 'pdf' | 'image' | 'note' | 'inknote' | 'other'

/** ノート（混在ノート .notedock・手書きノート .inkdock）か */
export const isNoteType = (t: FileType | undefined | null) => t === 'note' || t === 'inknote'

export type TreeNode = {
  name: string
  /** files/ からの相対パス */
  path: string
  kind: 'dir' | 'file'
  fileType?: FileType
  size?: number
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])

export function fileTypeOf(name: string): FileType {
  const ext = extname(name)
  if (ext === 'txt') return 'text'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'notedock') return 'note'
  if (ext === 'inkdock') return 'inknote'
  if (IMAGE_EXTS.has(ext)) return 'image'
  return 'other'
}

const abs = (projectId: string, rel: string) => joinPath(projectFilesDir(projectId), rel)

const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })

/** フォルダの中身。フォルダが先、それぞれ名前順。手書きの付属ファイルと *.tmp は出さない */
export async function listChildren(projectId: string, dir: string): Promise<TreeNode[]> {
  const entries = await getStorage().listDir(abs(projectId, dir))
  const names = new Set(entries.map((e) => e.name))
  const nodes: TreeNode[] = []
  for (const e of entries) {
    if (e.name.endsWith(TMP_SUFFIX)) continue
    if (e.kind === 'file' && isSidecar(e.name) && names.has(e.name.slice(0, -'.ink.json'.length))) continue
    // 書き込みに置いた画像のフォルダ（xxx.pdf.ink.assets）も出さない
    if (e.kind === 'dir' && e.name.endsWith(ASSETS_SUFFIX) && names.has(e.name.slice(0, -ASSETS_SUFFIX.length))) continue
    const path = joinPath(dir, e.name)
    // ノート（.notedock / .inkdock）はアプリ内ではフォルダだが、ツリーでは1つのファイルとして扱う
    if (e.kind === 'dir' && !isNoteExt(extname(e.name))) nodes.push({ name: e.name, path, kind: 'dir' })
    else nodes.push({ name: e.name, path, kind: 'file', fileType: fileTypeOf(e.name), size: e.size })
  }
  return nodes.sort((a, b) => (a.kind === b.kind ? collator.compare(a.name, b.name) : a.kind === 'dir' ? -1 : 1))
}

async function namesIn(projectId: string, dir: string): Promise<Set<string>> {
  return new Set((await getStorage().listDir(abs(projectId, dir))).map((e) => e.name))
}

/** 同じフォルダで重ならない名前（'メモ (2).txt'） */
export async function availableName(projectId: string, dir: string, name: string): Promise<string> {
  const names = await namesIn(projectId, dir)
  return uniqueName(name, (n) => names.has(n))
}

function checkName(name: string) {
  const error = validateName(name)
  if (error) throw new AppError(error)
}

export async function createFolder(projectId: string, parent: string, name: string): Promise<string> {
  checkName(name)
  const finalName = await availableName(projectId, parent, name)
  const path = joinPath(parent, finalName)
  await getStorage().mkdir(abs(projectId, path))
  await touchProject(projectId)
  return path
}

export async function createFile(projectId: string, parent: string, name: string, content: Blob | Uint8Array | string = ''): Promise<string> {
  checkName(name)
  const finalName = await availableName(projectId, parent, name)
  const path = joinPath(parent, finalName)
  await getStorage().writeFile(abs(projectId, path), content)
  await touchProject(projectId)
  return path
}

async function moveWithSidecar(projectId: string, from: string, to: string) {
  const storage = getStorage()
  await storage.move(abs(projectId, from), abs(projectId, to))
  for (const companion of [sidecarOf, assetsDirOf]) {
    if (await storage.exists(abs(projectId, companion(from)))) await storage.move(abs(projectId, companion(from)), abs(projectId, companion(to)))
  }
}

/** 名前の変更。同じ名前が既にあればエラーにする */
export async function renameEntry(projectId: string, path: string, newName: string): Promise<string> {
  checkName(newName)
  if (newName === basename(path)) return path
  const parent = dirname(path)
  const names = await namesIn(projectId, parent)
  // 大文字・小文字だけの変更は許す
  if (names.has(newName) && newName.toLowerCase() !== basename(path).toLowerCase()) throw new AppError('同じ名前のファイルまたはフォルダがあります')
  const to = joinPath(parent, newName)
  await moveWithSidecar(projectId, path, to)
  await touchProject(projectId)
  return to
}

/** 別のフォルダへ移動する。同じ名前があれば「名前 (2)」にする */
export async function moveEntry(projectId: string, path: string, destDir: string): Promise<string> {
  if (destDir === path || destDir.startsWith(`${path}/`)) throw new AppError('フォルダをその中には移動できません')
  if (dirname(path) === destDir) return path
  const to = joinPath(destDir, await availableName(projectId, destDir, basename(path)))
  await moveWithSidecar(projectId, path, to)
  await touchProject(projectId)
  return to
}

export async function duplicateEntry(projectId: string, path: string): Promise<string> {
  const storage = getStorage()
  const parent = dirname(path)
  const to = joinPath(parent, await availableName(projectId, parent, basename(path)))
  await storage.copy(abs(projectId, path), abs(projectId, to))
  for (const companion of [sidecarOf, assetsDirOf]) {
    if (await storage.exists(abs(projectId, companion(path)))) await storage.copy(abs(projectId, companion(path)), abs(projectId, companion(to)))
  }
  await touchProject(projectId)
  return to
}

export async function deleteEntry(projectId: string, path: string): Promise<void> {
  const storage = getStorage()
  await storage.remove(abs(projectId, path))
  await storage.remove(abs(projectId, sidecarOf(path)))
  await storage.remove(abs(projectId, assetsDirOf(path)))
  await touchProject(projectId)
}

export async function readEntry(projectId: string, path: string): Promise<File> {
  return getStorage().readFile(abs(projectId, path))
}

export async function writeEntry(projectId: string, path: string, data: Blob | Uint8Array | string): Promise<void> {
  await getStorage().writeFile(abs(projectId, path), data)
}

export async function entryExists(projectId: string, path: string): Promise<boolean> {
  return getStorage().exists(abs(projectId, path))
}

export async function isDirEntry(projectId: string, path: string): Promise<boolean> {
  return getStorage().isDir(abs(projectId, path))
}

/** フォルダ以下のすべてのファイル（ZIP 用）。付属ファイルも含む */
export async function walkFiles(projectId: string, dir = ''): Promise<string[]> {
  const storage = getStorage()
  const out: string[] = []
  for (const e of await storage.listDir(abs(projectId, dir))) {
    const path = joinPath(dir, e.name)
    if (e.kind === 'dir') out.push(...(await walkFiles(projectId, path)))
    else if (!e.name.endsWith(TMP_SUFFIX)) out.push(path)
  }
  return out
}
