// 取り込み時の画像処理: HEIC → JPEG 変換、iPad の Canvas 上限を超える画像の縮小

/** iPad の Canvas の上限（約1677万画素）より少し小さくする */
export const MAX_IMAGE_PIXELS = 16_000_000

export const isHeic = (file: File) => /hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)

export const isImageFile = (file: File) => file.type.startsWith('image/') || isHeic(file) || /\.(png|jpe?g|webp|gif)$/i.test(file.name)

/** 縮小後の大きさ（上限以内ならそのまま） */
export function fitPixels(width: number, height: number, max = MAX_IMAGE_PIXELS): { width: number; height: number; scaled: boolean } {
  if (width * height <= max) return { width, height, scaled: false }
  const scale = Math.sqrt(max / (width * height))
  return { width: Math.floor(width * scale), height: Math.floor(height * scale), scaled: true }
}

function replaceExt(name: string, ext: string) {
  const i = name.lastIndexOf('.')
  return `${i > 0 ? name.slice(0, i) : name}.${ext}`
}

async function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を変換できませんでした'))), type, quality))
}

/**
 * 取り込む画像を必要に応じて変換する。
 * - HEIC / HEIF は JPEG に変換（Windows のブラウザで表示できないため）
 * - 画素数が上限を超える画像は縮小（JPEG は JPEG、それ以外は PNG）
 */
export async function prepareImage(file: File): Promise<{ data: Blob; name: string; converted: boolean }> {
  const heic = isHeic(file)
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    if (heic) throw new Error(`「${file.name}」を読み込めませんでした。HEIC画像はiPadで取り込んでください`)
    // GIF など、読み込めない画像はそのまま保存する
    return { data: file, name: file.name, converted: false }
  }
  try {
    const size = fitPixels(bitmap.width, bitmap.height)
    if (!heic && !size.scaled) return { data: file, name: file.name, converted: false }
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, size.width, size.height)
    const jpeg = heic || /jpe?g/i.test(file.type) || /\.jpe?g$/i.test(file.name)
    const data = await toBlob(canvas, jpeg ? 'image/jpeg' : 'image/png', jpeg ? 0.9 : undefined)
    canvas.width = 0
    canvas.height = 0
    const name = heic ? replaceExt(file.name, 'jpg') : jpeg ? file.name : replaceExt(file.name, 'png')
    return { data, name, converted: true }
  } finally {
    bitmap.close()
  }
}
