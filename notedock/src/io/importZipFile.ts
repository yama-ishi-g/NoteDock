import type { ProjectMeta } from '../formats/project'
import { useAppStore } from '../state/appStore'
import { dialogs } from '../state/dialogs'
import { findProjectByName, importZipProject, parseProjectZip } from './projectZip'

/** ZIP を読み込み、同じ名前のプロジェクトがあれば上書きか別名かを選んでもらう */
export async function importZipFile(file: File): Promise<ProjectMeta[]> {
  const { toast } = useAppStore.getState()
  const parsed = parseProjectZip(new Uint8Array(await file.arrayBuffer()), file.name)
  const imported: ProjectMeta[] = []
  for (const zp of parsed) {
    let mode: 'new' | 'overwrite' = 'new'
    if (await findProjectByName(zp.name)) {
      const choice = await dialogs.choose({
        title: `「${zp.name}」は既にあります`,
        message: '読み込み方法を選んでください',
        options: [
          { value: 'overwrite', label: '上書き（今のプロジェクトを置き換える）', danger: true },
          { value: 'new', label: '別名で追加' },
        ],
      })
      if (!choice) continue
      mode = choice
    }
    imported.push(await importZipProject(zp, mode))
  }
  if (imported.length) toast(`${imported.map((p) => `「${p.name}」`).join('、')}を読み込みました`)
  return imported
}
