// 手書きのデータ（内部仕様書 5.2）

export type InkTool = 'pen' | 'marker'
export type Tool = InkTool | 'eraser' | 'lasso'
export type SizeLevel = 0 | 1 | 2

export type Stroke = {
  id: string
  tool: InkTool
  /** '#RRGGBB' */
  color: string
  /** 基準の太さ（座標系の単位） */
  size: number
  /** pen=1, marker=0.35 */
  opacity: number
  /** [x, y, pressure, t, x, y, pressure, t, ...]（t は開始からの ms） */
  points: number[]
  /** 直線化した線 */
  isLine?: boolean
}

export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }

export const POINT_STRIDE = 4

/** ツールごとの太さ（論理座標の単位。手書きブロックは横幅1000） */
export const PEN_SIZES = [2.5, 4, 7] as const
export const MARKER_SIZES = [12, 20, 32] as const
export const ERASER_RADII = [6, 12, 24] as const

export const MARKER_OPACITY = 0.35

/** 色のプリセット（外部仕様書 5.1） */
export const PRESET_COLORS = ['#2c2c2a', '#888780', '#e24b4a', '#378add', '#639922', '#ef9f27', '#d85a30', '#7f77dd'] as const

export const pointCount = (s: Stroke) => s.points.length / POINT_STRIDE

export function strokeBounds(s: Stroke): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < s.points.length; i += POINT_STRIDE) {
    const x = s.points[i], y = s.points[i + 1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const pad = s.size / 2
  return { x: minX - pad, y: minY - pad, width: maxX - minX + s.size, height: maxY - minY + s.size }
}

export function unionBounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of rects) {
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export const rectsIntersect = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** 保存用に小数を丸める（座標は小数第2位、筆圧は第3位、時刻は整数） */
export function roundStroke(s: Stroke): Stroke {
  const points = s.points.map((v, i) => {
    const k = i % POINT_STRIDE
    if (k === 2) return Math.round(v * 1000) / 1000
    if (k === 3) return Math.round(v)
    return Math.round(v * 100) / 100
  })
  return { ...s, points }
}

export const newStrokeId = () => crypto.randomUUID()
