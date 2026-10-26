import { zipSync, type Zippable } from 'fflate'
import { readEntry, walkFiles } from '../services/files'
import { toBytes } from '../storage/StorageService'

const STORED_EXT = /\.(pdf|png|jpe?g|webp|gif|zip|notedock)$/i

/** プロジェクト内のフォルダを ZIP にする（ZIP の中ではフォルダ名を最上位にする） */
export async function zipFolder(projectId: string, dir: string): Promise<Uint8Array> {
  const name = dir.slice(dir.lastIndexOf('/') + 1)
  const entries: Zippable = {}
  const files = await walkFiles(projectId, dir)
  if (!files.length) entries[`${name}/`] = new Uint8Array(0)
  for (const path of files) {
    const bytes = await toBytes(await readEntry(projectId, path))
    entries[`${name}/${path.slice(dir.length + 1)}`] = [bytes, { level: STORED_EXT.test(path) ? 0 : 6 }]
  }
  return zipSync(entries)
}
