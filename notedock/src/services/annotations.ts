import { emptySidecar, migrateSidecar, type InkSidecar } from '../formats/inkSidecar'
import { projectFilesDir } from '../formats/project'
import { roundStroke } from '../ink/model'
import { getStorage } from '../storage'
import { joinPath, sidecarOf } from '../storage/paths'

// PDF・画像の書き込み（付属ファイル）の読み書き

const abs = (projectId: string, path: string) => joinPath(projectFilesDir(projectId), path)

export async function loadSidecar(projectId: string, path: string, coordSpace: InkSidecar['coordSpace']): Promise<InkSidecar> {
  const storage = getStorage()
  const file = await storage.readFile(abs(projectId, path))
  const target = { name: file.name, size: file.size, lastModified: file.lastModified }
  try {
    return migrateSidecar(await storage.readJson(abs(projectId, sidecarOf(path))), coordSpace, target)
  } catch {
    return emptySidecar(coordSpace, target)
  }
}

export async function saveSidecar(projectId: string, path: string, sidecar: InkSidecar): Promise<void> {
  const pages: InkSidecar['pages'] = {}
  for (const [k, p] of Object.entries(sidecar.pages)) {
    // 線も置いたものもないページは保存しない
    if (p.strokes.length || p.items?.length) pages[k] = { ...p, strokes: p.strokes.map(roundStroke) }
  }
  const storage = getStorage()
  if (!Object.keys(pages).length) {
    await storage.remove(abs(projectId, sidecarOf(path)))
    return
  }
  await storage.writeFile(abs(projectId, sidecarOf(path)), JSON.stringify({ ...sidecar, pages }))
}
