import type { SizeLevel } from './model'

// 手書きの欄に置く画像・テキストボックス（座標は手書きの線と同じ論理座標）
// 重なり順は「置いたもの（下）→ 手書きの線（上）」。画像や文字の上から書き込めるようにするため

export type ImageItem = {
  id: string
  type: 'image'
  /** 画像ファイルの場所（置き場所ごとの相対パス。ink/assets.ts を参照） */
  src: string
  x: number
  y: number
  w: number
  h: number
}

export type TextItem = {
  id: string
  type: 'text'
  x: number
  y: number
  /** 枠の幅（高さは文字の量で決まる） */
  w: number
  text: string
  level: SizeLevel
  /** 文字の大きさ（論理座標）。level と座標系の幅から決める */
  fontSize: number
  color: string
}

export type InkItem = ImageItem | TextItem

/** 文字の大きさ（横幅1000の座標系での値）。小・中・大 */
export const TEXT_SIZES = [18, 28, 44] as const
export const TEXT_LINE_HEIGHT = 1.4

/** 座標系の幅に合わせた文字の大きさ（PDF は約600pt、画像は数千px のため） */
export const fontSizeFor = (level: SizeLevel, logicalWidth: number) => Math.round(TEXT_SIZES[level] * (logicalWidth / 1000) * 10) / 10

export function newTextItem(x: number, y: number, logicalWidth: number, level: SizeLevel, color: string): TextItem {
  return { id: crypto.randomUUID(), type: 'text', x, y, w: Math.round(logicalWidth * 0.4), text: '', level, fontSize: fontSizeFor(level, logicalWidth), color }
}

/** 見えている範囲の中央に、横幅の 40%（画像が小さければそのまま）で置く */
export function newImageItem(src: string, imgW: number, imgH: number, view: { x: number; y: number; width: number; height: number }, logicalWidth: number): ImageItem {
  const w = Math.min(imgW, logicalWidth * 0.4)
  const h = (w * imgH) / imgW
  return { id: crypto.randomUUID(), type: 'image', src, x: Math.max(0, view.x + (view.width - w) / 2), y: Math.max(0, view.y + (view.height - h) / 2), w, h }
}

export function migrateItems(raw: unknown): InkItem[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((i): i is InkItem => !!i && typeof i.id === 'string' && (i.type === 'image' || i.type === 'text') && Number.isFinite(i.x) && Number.isFinite(i.y))
}

/** 文字を枠の幅で折り返す（日本語は空白がないため1文字ずつ測る）。Canvas に描くときに使う */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const ch of para) {
      if (line && measure(line + ch) > maxWidth) {
        lines.push(line)
        line = ch
      } else {
        line += ch
      }
    }
    lines.push(line)
  }
  return lines
}
