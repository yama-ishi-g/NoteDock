import type { AssetResolver } from '../ink/assets'
import { TEXT_LINE_HEIGHT, wrapText, type InkItem, type TextItem } from '../ink/items'

// 置いたもの（画像・テキストボックス）を Canvas に描く（書き出し・焼き込み用）。座標は手書きと同じ論理座標

const FONT = '-apple-system, system-ui, "Hiragino Sans", "Yu Gothic UI", sans-serif'

function drawText(ctx: CanvasRenderingContext2D, item: TextItem, x: number, y: number) {
  ctx.font = `${item.fontSize}px ${FONT}`
  ctx.fillStyle = item.color
  ctx.textBaseline = 'top'
  const lh = item.fontSize * TEXT_LINE_HEIGHT
  const lines = wrapText(item.text, item.w, (t) => ctx.measureText(t).width)
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lh + (lh - item.fontSize) / 2))
  return lines.length * lh
}

/** 置いたものの下端（論理座標） */
export function itemsBottom(items: InkItem[]): number {
  let max = 0
  let probe: CanvasRenderingContext2D | null = null
  for (const item of items) {
    if (item.type === 'image') max = Math.max(max, item.y + item.h)
    else if (item.text.trim()) {
      probe ??= document.createElement('canvas').getContext('2d')!
      probe.font = `${item.fontSize}px ${FONT}`
      const lines = wrapText(item.text, item.w, (t) => probe!.measureText(t).width)
      max = Math.max(max, item.y + lines.length * item.fontSize * TEXT_LINE_HEIGHT)
    }
  }
  return max
}

/** 置いたものを描く（手書きの線より先に描く） */
export async function drawItems(ctx: CanvasRenderingContext2D, items: InkItem[], assets: AssetResolver | undefined) {
  for (const item of items) {
    if (item.type === 'image') {
      if (!assets) continue
      try {
        const bmp = await createImageBitmap(await assets.read(item.src))
        ctx.drawImage(bmp, item.x, item.y, item.w, item.h)
        bmp.close()
      } catch {
        // 画像が見つからなければ描かない
      }
    } else if (item.text.trim()) {
      drawText(ctx, item, item.x, item.y)
    }
  }
}

/** テキストボックスを PNG にする（PDF へ焼き込むため。日本語のフォントを PDF に入れずに済む） */
export async function textItemPng(item: TextItem, scale = 3): Promise<{ png: Uint8Array; height: number } | null> {
  if (!item.text.trim()) return null
  const probe = document.createElement('canvas').getContext('2d')!
  probe.font = `${item.fontSize}px ${FONT}`
  const lines = wrapText(item.text, item.w, (t) => probe.measureText(t).width)
  const height = lines.length * item.fontSize * TEXT_LINE_HEIGHT
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(item.w * scale))
  canvas.height = Math.max(1, Math.ceil(height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  drawText(ctx, item, 0, 0)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  canvas.width = 0
  canvas.height = 0
  return blob ? { png: new Uint8Array(await blob.arrayBuffer()), height } : null
}
