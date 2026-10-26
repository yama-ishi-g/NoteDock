import { joinPath } from '../storage/paths'

export const PROJECTS_DIR = 'projects'

export type ProjectMeta = {
  formatVersion: 1
  id: string
  name: string
  createdAt: string
  updatedAt: string
  treeState?: { expanded: string[] }
}

export const projectDir = (id: string) => joinPath(PROJECTS_DIR, id)
export const projectMetaPath = (id: string) => joinPath(PROJECTS_DIR, id, 'project.json')
/** プロジェクト内のユーザーのファイル（実名のツリー）のルート */
export const projectFilesDir = (id: string) => joinPath(PROJECTS_DIR, id, 'files')

/** 読み込んだ project.json を現在の形式にそろえる */
export function migrateProjectMeta(raw: unknown): ProjectMeta {
  const m = raw as Partial<ProjectMeta>
  if (!m || typeof m.id !== 'string' || typeof m.name !== 'string') throw new Error('project.json の形式が正しくありません')
  const now = new Date().toISOString()
  return {
    formatVersion: 1,
    id: m.id,
    name: m.name,
    createdAt: m.createdAt ?? now,
    updatedAt: m.updatedAt ?? m.createdAt ?? now,
    treeState: { expanded: m.treeState?.expanded ?? [] },
  }
}
