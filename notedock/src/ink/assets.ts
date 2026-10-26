import { projectFilesDir } from '../formats/project'
import { prepareImage } from '../io/images'
import { getStorage } from '../storage'
import { extname, joinPath } from '../storage/paths'

// 手書きの欄に置いた画像の保存場所
//   ノート（.mixdock / .notedock）: ノートのフォルダの images/ （src = images/xxx.jpg）
//   PDF・画像への書き込み: 付属フォルダ xxx.pdf.ink.assets/ （src = xxx.jpg）

export type AssetResolver = {
  /** 表示用の URL（使い終わったら URL.revokeObjectURL する） */
  url: (src: string) => Promise<string>
  read: (src: string) => Promise<Blob>
  /** 取り込んで保存し、src と画像の大きさを返す（HEIC は JPEG に変換、大きい画像は縮小） */
  store: (file: File) => Promise<{ src: string; width: number; height: number }>
}

export const ASSETS_SUFFIX = '.ink.assets'
export const assetsDirOf = (path: string) => `${path}${ASSETS_SUFFIX}`

function resolver(projectId: string, baseDir: string, srcPrefix: string): AssetResolver {
  const abs = (src: string) => joinPath(projectFilesDir(projectId), baseDir, src)
  const read = (src: string) => getStorage().readFile(abs(src))
  return {
    read,
    url: async (src) => URL.createObjectURL(await read(src)),
    store: async (file) => {
      const prepared = await prepareImage(file)
      const src = `${srcPrefix}${crypto.randomUUID()}.${extname(prepared.name) || 'jpg'}`
      const bmp = await createImageBitmap(prepared.data)
      const size = { width: bmp.width, height: bmp.height }
      bmp.close()
      await getStorage().writeFile(abs(src), prepared.data)
      return { src, ...size }
    },
  }
}

/** ノートの中の手書きブロックに置く画像 */
export const noteAssets = (projectId: string, notePath: string) => resolver(projectId, notePath, 'images/')

/** PDF・画像（ノートの画像ブロックを含む）への書き込みに置く画像 */
export const sidecarAssets = (projectId: string, filePath: string) => resolver(projectId, assetsDirOf(filePath), '')
