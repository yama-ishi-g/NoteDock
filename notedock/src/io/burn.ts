import type { InkSidecar } from '../formats/inkSidecar'
import { sidecarAssets, type AssetResolver } from '../ink/assets'
import type { InkItem } from '../ink/items'
import type { Stroke } from '../ink/model'
import { strokePath, strokeSvgPath } from '../ink/render'
import { loadSidecar } from '../services/annotations'
import { readEntry } from '../services/files'
import { extname, stem } from '../storage/paths'
import { drawItems, textItemPng } from './drawItems'
import { makeFile } from './share'

// 書き込みを焼き込んだ新しいファイルを作る（内部仕様書 8.2・8.3・8.7）。元のファイルは変更しない

export type ExportNaming = 'suffix' | 'original'

export function burnedName(name: string, outExt: string, naming: ExportNaming): string {
  return naming === 'original' ? `${stem(name)}.${outExt}` : `${stem(name)}_書き込み.${outExt}`
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return [0, 0, 0]
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
}

/** 画像に置いたものと線を合成した画像（JPEG または PNG）を作る */
export async function composeImage(file: Blob, strokes: Stroke[], jpeg: boolean, items: InkItem[] = [], assets?: AssetResolver): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bmp.width
  canvas.height = bmp.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bmp, 0, 0)
  bmp.close()
  await drawItems(ctx, items, assets)
  for (const s of strokes) {
    ctx.globalAlpha = s.opacity
    ctx.fillStyle = s.color
    ctx.fill(strokePath(s))
  }
  ctx.globalAlpha = 1
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), jpeg ? 'image/jpeg' : 'image/png', jpeg ? 0.92 : undefined),
  )
  canvas.width = 0
  canvas.height = 0
  return blob
}

/** 画像に書き込みを合成する。元が JPEG なら JPEG、それ以外は PNG */
export async function burnImage(projectId: string, path: string, naming: ExportNaming): Promise<File> {
  const file = await readEntry(projectId, path)
  const sidecar = await loadSidecar(projectId, path, 'image-px')
  const jpeg = ['jpg', 'jpeg'].includes(extname(path))
  const page = sidecar.pages['0']
  const blob = await composeImage(file, page?.strokes ?? [], jpeg, page?.items ?? [], sidecarAssets(projectId, path))
  return makeFile(blob, burnedName(path.slice(path.lastIndexOf('/') + 1), jpeg ? 'jpg' : 'png', naming))
}

/**
 * pdf.js の表示座標（scale 1、ページの回転を反映）→ PDF の座標 への変換行列。
 * drawSvgPath は y を反転する（scale(1, -1)）ため、その分を打ち消した行列にする
 */
export function viewToPdfMatrix(rotation: number, box: { x: number; y: number; width: number; height: number }): [number, number, number, number, number, number] {
  const { x, y, width: w, height: h } = box
  // pdf = M * view
  let m: [number, number, number, number, number, number]
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      m = [0, 1, 1, 0, x, y]
      break
    case 180:
      m = [-1, 0, 0, 1, x + w, y]
      break
    case 270:
      m = [0, -1, -1, 0, x + w, y + h]
      break
    default:
      m = [1, 0, 0, -1, x, y + h]
  }
  // M * diag(1, -1)
  return [m[0], m[1], -m[2], -m[3], m[4], m[5]]
}

/** JPEG・PNG 以外（GIF・WebP など）は JPEG にしてから PDF に入れる */
async function toJpeg(blob: Blob, bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return bytes
  const out = await composeImage(blob, [], true)
  return new Uint8Array(await out.arrayBuffer())
}

/** PDF の各ページに書き込みを焼き込む（pdf-lib） */
export async function burnPdf(projectId: string, path: string, naming: ExportNaming): Promise<File> {
  const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = await import('pdf-lib')
  const file = await readEntry(projectId, path)
  const sidecar: InkSidecar = await loadSidecar(projectId, path, 'pdf-page')
  const pdf = await PDFDocument.load(await file.arrayBuffer())
  const pages = pdf.getPages()
  const assets = sidecarAssets(projectId, path)
  for (const [key, page] of Object.entries(sidecar.pages)) {
    const p = pages[Number(key)]
    const items = page.items ?? []
    if (!p || (!page.strokes.length && !items.length)) continue
    const box = p.getCropBox()
    const [a, b, c, d, e, f] = viewToPdfMatrix(p.getRotation().angle, box)
    p.pushOperators(pushGraphicsState(), concatTransformationMatrix(a, b, c, d, e, f))
    // 置いたもの（線の下）。この座標系は y が反転しているので、下端 -(y+h) から描く
    for (const item of items) {
      try {
        if (item.type === 'image') {
          const blob = await assets.read(item.src)
          const bytes = new Uint8Array(await blob.arrayBuffer())
          const png = bytes[0] === 0x89 && bytes[1] === 0x50
          const img = png ? await pdf.embedPng(bytes) : await pdf.embedJpg(await toJpeg(blob, bytes))
          p.drawImage(img, { x: item.x, y: -item.y - item.h, width: item.w, height: item.h })
        } else {
          const t = await textItemPng(item)
          if (!t) continue
          const img = await pdf.embedPng(t.png)
          p.drawImage(img, { x: item.x, y: -item.y - t.height, width: item.w, height: t.height })
        }
      } catch {
        // 読めないものは焼き込まない
      }
    }
    for (const s of page.strokes as Stroke[]) {
      const [r, g, bl] = hexToRgb(s.color)
      p.drawSvgPath(strokeSvgPath(s), { x: 0, y: 0, color: rgb(r, g, bl), opacity: s.opacity })
    }
    p.pushOperators(popGraphicsState())
  }
  const bytes = await pdf.save()
  return makeFile(bytes, burnedName(path.slice(path.lastIndexOf('/') + 1), 'pdf', naming))
}
