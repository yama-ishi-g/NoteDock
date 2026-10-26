import { createFile } from '../services/files'
import { importNoteZip } from '../services/notes'
import { extname } from '../storage/paths'
import { isImageFile, prepareImage } from './images'

export const IMPORT_EXTENSIONS = ['txt', 'md', 'notedock', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'heif']

/** <input type="file"> の accept。画像を含めると iPad は 写真ライブラリ／写真を撮る／ファイルを選択 を表示する */
export const IMPORT_ACCEPT = ['.txt', '.md', '.notedock', '.pdf', 'image/*', '.heic', '.heif', 'text/plain', 'text/markdown', 'application/pdf'].join(',')

export type ImportResult = {
  imported: string[]
  skipped: { name: string; reason: string }[]
}

/** 撮った写真の名前（写真_YYYYMMDD_HHMMSS.jpg） */
export function cameraFileName(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `写真_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.jpg`
}

/** ファイルを取り込み、指定のフォルダに保存する。同じ名前があれば「名前 (2)」にする */
export async function importFiles(projectId: string, dir: string, files: File[], opts: { fromCamera?: boolean } = {}): Promise<ImportResult> {
  const result: ImportResult = { imported: [], skipped: [] }
  for (const file of files) {
    const ext = extname(file.name)
    try {
      if (opts.fromCamera || isImageFile(file)) {
        const prepared = await prepareImage(file)
        const name = opts.fromCamera ? cameraFileName() : prepared.name
        result.imported.push(await createFile(projectId, dir, name, prepared.data))
      } else if (ext === 'notedock') {
        // .notedock（ZIP）はノートのフォルダとして展開する
        result.imported.push(await importNoteZip(projectId, dir, file.name, new Uint8Array(await file.arrayBuffer())))
      } else if (IMPORT_EXTENSIONS.includes(ext)) {
        result.imported.push(await createFile(projectId, dir, file.name, file))
      } else {
        result.skipped.push({ name: file.name, reason: '取り込めない形式です' })
      }
    } catch (err) {
      result.skipped.push({ name: file.name, reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return result
}
