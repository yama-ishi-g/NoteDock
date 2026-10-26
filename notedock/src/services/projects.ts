import { migrateProjectMeta, PROJECTS_DIR, projectDir, projectFilesDir, projectMetaPath, type ProjectMeta } from '../formats/project'
import { getStorage } from '../storage'
import { isSidecar, TMP_SUFFIX, validateName } from '../storage/paths'
import { NotFoundError } from '../storage/StorageService'

export type ProjectSummary = ProjectMeta & { fileCount?: number }

export class AppError extends Error {}

export async function listProjects(): Promise<ProjectMeta[]> {
  const storage = getStorage()
  await storage.mkdir(PROJECTS_DIR)
  const result: ProjectMeta[] = []
  for (const entry of await storage.listDir(PROJECTS_DIR)) {
    if (entry.kind !== 'dir') continue
    try {
      result.push(migrateProjectMeta(await storage.readJson(projectMetaPath(entry.name))))
    } catch {
      // project.json が壊れている・ないフォルダは一覧に出さない
    }
  }
  return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getProject(id: string): Promise<ProjectMeta> {
  return migrateProjectMeta(await getStorage().readJson(projectMetaPath(id)))
}

export async function saveProject(meta: ProjectMeta): Promise<void> {
  await getStorage().writeJson(projectMetaPath(meta.id), meta)
}

async function assertNameAvailable(name: string, exceptId?: string) {
  const error = validateName(name)
  if (error) throw new AppError(error)
  const projects = await listProjects()
  if (projects.some((p) => p.name === name && p.id !== exceptId)) throw new AppError('同じ名前のプロジェクトがあります')
}

export async function createProject(name: string): Promise<ProjectMeta> {
  const trimmed = name.trim()
  await assertNameAvailable(trimmed)
  const now = new Date().toISOString()
  const meta: ProjectMeta = { formatVersion: 1, id: crypto.randomUUID(), name: trimmed, createdAt: now, updatedAt: now, treeState: { expanded: [] } }
  await getStorage().mkdir(projectFilesDir(meta.id))
  await saveProject(meta)
  return meta
}

export async function renameProject(id: string, name: string): Promise<ProjectMeta> {
  const trimmed = name.trim()
  await assertNameAvailable(trimmed, id)
  const meta = { ...(await getProject(id)), name: trimmed, updatedAt: new Date().toISOString() }
  await saveProject(meta)
  return meta
}

export async function deleteProject(id: string): Promise<void> {
  await getStorage().remove(projectDir(id))
}

/** ファイルを変更したときに最終更新日時を更新する */
export async function touchProject(id: string): Promise<void> {
  try {
    const meta = await getProject(id)
    await saveProject({ ...meta, updatedAt: new Date().toISOString() })
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err
  }
}

/** プロジェクト内のファイル数（手書きの付属ファイルは数えない） */
export async function countFiles(id: string): Promise<number> {
  const storage = getStorage()
  const walk = async (dir: string): Promise<number> => {
    let n = 0
    for (const e of await storage.listDir(dir)) {
      if (e.kind === 'dir') n += e.name.endsWith('.notedock') ? 1 : await walk(`${dir}/${e.name}`)
      else if (!isSidecar(e.name) && !e.name.endsWith(TMP_SUFFIX)) n++
    }
    return n
  }
  try {
    return await walk(projectFilesDir(id))
  } catch {
    return 0
  }
}

/**
 * 書き込みの途中で終了した場合に残る *.tmp を片付ける。
 * 元のファイルがあれば tmp を削除、なければ tmp を本来の名前に戻す
 */
export async function recoverTempFiles(id: string): Promise<number> {
  const storage = getStorage()
  let recovered = 0
  const walk = async (dir: string) => {
    const entries = await storage.listDir(dir)
    const names = new Set(entries.map((e) => e.name))
    for (const e of entries) {
      const path = `${dir}/${e.name}`
      if (e.kind === 'dir') {
        await walk(path)
      } else if (e.name.endsWith(TMP_SUFFIX)) {
        const original = e.name.slice(0, -TMP_SUFFIX.length)
        if (names.has(original)) await storage.remove(path)
        else await storage.move(path, `${dir}/${original}`)
        recovered++
      }
    }
  }
  try {
    await walk(projectDir(id))
  } catch {
    // 読めない場合は何もしない
  }
  return recovered
}
