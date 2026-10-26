import { unzipSync, zipSync, type Zippable } from 'fflate'
import { migrateProjectMeta, projectFilesDir, type ProjectMeta } from '../formats/project'
import { createProject, getProject, deleteProject, listProjects, saveProject } from '../services/projects'
import { getStorage } from '../storage'
import { joinPath, stem, TMP_SUFFIX, uniqueName } from '../storage/paths'
import { toBytes } from '../storage/StorageService'
import { makeFile } from './share'

export const PROJECT_MARKER = 'notedock-project.json'

// 既に圧縮されている形式は、もう一度圧縮しない
const STORED_EXT = /\.(pdf|png|jpe?g|webp|gif|zip|notedock)$/i

export function dateStamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
}

/** プロジェクトのファイルを ZIP の項目にする（空のフォルダも残す） */
async function collect(projectId: string, prefix: string, out: Zippable) {
  const storage = getStorage()
  const root = projectFilesDir(projectId)
  const walk = async (rel: string) => {
    const entries = await storage.listDir(joinPath(root, rel))
    if (!entries.length && rel) out[`${prefix}${rel}/`] = new Uint8Array(0)
    for (const e of entries) {
      const path = joinPath(rel, e.name)
      if (e.kind === 'dir') await walk(path)
      else if (!e.name.endsWith(TMP_SUFFIX)) {
        const bytes = await toBytes(await storage.readFile(joinPath(root, path)))
        out[`${prefix}${path}`] = [bytes, { level: STORED_EXT.test(e.name) ? 0 : 6 }]
      }
    }
  }
  await walk('')
}

function metaBytes(meta: ProjectMeta) {
  return new TextEncoder().encode(JSON.stringify({ ...meta, treeState: undefined }, null, 2))
}

export async function exportProjectZip(projectId: string): Promise<File> {
  const meta = await getProject(projectId)
  const entries: Zippable = { [PROJECT_MARKER]: metaBytes(meta) }
  await collect(projectId, '', entries)
  return makeFile(zipSync(entries), `${meta.name}_${dateStamp()}.zip`)
}

/** すべてのプロジェクトを1つの ZIP にする（プロジェクトごとのフォルダ） */
export async function exportAllZip(): Promise<File> {
  const entries: Zippable = {}
  for (const meta of await listProjects()) {
    entries[`${meta.name}/${PROJECT_MARKER}`] = metaBytes(meta)
    await collect(meta.id, `${meta.name}/`, entries)
  }
  return makeFile(zipSync(entries), `NoteDock_全データ_${dateStamp()}.zip`)
}

export type ZipProject = {
  name: string
  meta?: ProjectMeta
  files: Map<string, Uint8Array>
  dirs: string[]
}

const IGNORED = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)/i

// Windows で扱えない文字は '_' に置き換える
const sanitize = (path: string) =>
  path
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..')
    // oxlint-disable-next-line no-control-regex
    .map((p) => p.replace(/[\\:*?"<>|\u0000-\u001f]/g, '_').replace(/[ .]+$/, '_'))
    .join('/')

/**
 * ZIP の中身をプロジェクトに分ける。
 * - 最上位に notedock-project.json がある → NoteDock で書き出したプロジェクト
 * - 最上位のフォルダそれぞれに notedock-project.json がある → 全データの書き出し（複数のプロジェクト）
 * - それ以外 → 普通の ZIP。最上位のフォルダが1つだけなら、その中身をルートにする
 */
export function parseProjectZip(bytes: Uint8Array, zipName: string): ZipProject[] {
  const raw = unzipSync(bytes)
  const files = new Map<string, Uint8Array>()
  const dirs: string[] = []
  for (const [name, data] of Object.entries(raw)) {
    if (IGNORED.test(name)) continue
    const path = sanitize(name)
    if (!path) continue
    if (name.endsWith('/')) dirs.push(path)
    else files.set(path, data)
  }

  const decodeMeta = (data: Uint8Array | undefined) => {
    if (!data) return undefined
    try {
      return migrateProjectMeta(JSON.parse(new TextDecoder().decode(data)))
    } catch {
      return undefined
    }
  }
  const sub = (prefix: string): Pick<ZipProject, 'files' | 'dirs'> => {
    const f = new Map<string, Uint8Array>()
    for (const [p, d] of files) if (p.startsWith(prefix) && p !== `${prefix}${PROJECT_MARKER}`) f.set(p.slice(prefix.length), d)
    return { files: f, dirs: dirs.filter((d) => d.startsWith(prefix)).map((d) => d.slice(prefix.length)).filter(Boolean) }
  }

  const rootMeta = decodeMeta(files.get(PROJECT_MARKER))
  if (rootMeta) return [{ name: rootMeta.name, meta: rootMeta, ...sub('') }]

  const tops = new Set([...files.keys(), ...dirs].map((p) => p.split('/')[0]))
  const allHaveMeta = tops.size > 0 && [...tops].every((t) => files.has(`${t}/${PROJECT_MARKER}`))
  if (allHaveMeta) {
    return [...tops].map((t) => {
      const meta = decodeMeta(files.get(`${t}/${PROJECT_MARKER}`))
      return { name: meta?.name ?? t, meta, ...sub(`${t}/`) }
    })
  }

  const onlyTop = tops.size === 1 && ![...files.keys()].includes([...tops][0]) ? [...tops][0] : null
  if (onlyTop) return [{ name: onlyTop, ...sub(`${onlyTop}/`) }]
  return [{ name: stem(zipName) || 'インポート', ...sub('') }]
}

/** 同じ名前のプロジェクトがあるか */
export async function findProjectByName(name: string): Promise<ProjectMeta | undefined> {
  return (await listProjects()).find((p) => p.name === name)
}

/**
 * ZIP のプロジェクトを保存する。
 * overwrite のときは、新しいプロジェクトの書き込みが終わってから古いプロジェクトを削除する（途中で失敗しても元のデータを失わない）
 */
export async function importZipProject(zp: ZipProject, mode: 'new' | 'overwrite', onProgress?: (done: number, total: number) => void): Promise<ProjectMeta> {
  const existing = await findProjectByName(zp.name)
  const projects = await listProjects()
  const names = new Set(projects.map((p) => p.name))
  const name = mode === 'overwrite' || !existing ? zp.name : uniqueName(zp.name, (n) => names.has(n))
  // 上書きの間は、同じ名前の検証に引っかからないよう仮の名前で作る
  const tempName = mode === 'overwrite' && existing ? uniqueName(`${zp.name}（読み込み中）`, (n) => names.has(n)) : name
  const meta = await createProject(tempName)
  const storage = getStorage()
  const root = projectFilesDir(meta.id)
  try {
    for (const d of zp.dirs) await storage.mkdir(joinPath(root, d))
    let done = 0
    for (const [path, data] of zp.files) {
      await storage.writeFile(joinPath(root, path), data)
      onProgress?.(++done, zp.files.size)
    }
  } catch (err) {
    await deleteProject(meta.id)
    throw err
  }
  if (mode === 'overwrite' && existing) await deleteProject(existing.id)
  const final: ProjectMeta = { ...meta, name, createdAt: zp.meta?.createdAt ?? meta.createdAt, updatedAt: new Date().toISOString() }
  await saveProject(final)
  return final
}
