import { newStrokeId, POINT_STRIDE, strokeBounds, type Point, type Stroke } from './model'

// 消しゴム・投げ縄・直線化・移動の計算（画面に依存しない純粋な関数）

/** 点の間隔が step 以下になるよう補間する（2点だけの直線も途中で消せるようにする） */
export function densify(points: number[], step: number): number[] {
  if (points.length <= POINT_STRIDE) return points.slice()
  const out = points.slice(0, POINT_STRIDE)
  for (let i = POINT_STRIDE; i < points.length; i += POINT_STRIDE) {
    const x0 = points[i - 4], y0 = points[i - 3], p0 = points[i - 2], t0 = points[i - 1]
    const x1 = points[i], y1 = points[i + 1], p1 = points[i + 2], t1 = points[i + 3]
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step))
    for (let k = 1; k <= n; k++) {
      const t = k / n
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p0 + (p1 - p0) * t, t0 + (t1 - t0) * t)
    }
  }
  return out
}

/**
 * 消しゴム（円）にかかった部分を取り除き、残りを別々の線に分ける（内部仕様書 6.5）。
 * かからなければ null。かかった場合は分割後の線（0本以上）
 */
export function eraseStroke(stroke: Stroke, cx: number, cy: number, radius: number, step = 2): Stroke[] | null {
  const reach = radius + stroke.size / 2
  const b = strokeBounds(stroke)
  if (cx < b.x - radius || cx > b.x + b.width + radius || cy < b.y - radius || cy > b.y + b.height + radius) return null

  const pts = densify(stroke.points, step)
  const hit: boolean[] = []
  let any = false
  for (let i = 0; i < pts.length; i += POINT_STRIDE) {
    const h = Math.hypot(pts[i] - cx, pts[i + 1] - cy) <= reach
    hit.push(h)
    any ||= h
  }
  if (!any) return null

  const pieces: Stroke[] = []
  let run: number[] = []
  const flush = () => {
    if (run.length >= POINT_STRIDE * 2) pieces.push({ ...stroke, id: newStrokeId(), points: run, isLine: false })
    run = []
  }
  hit.forEach((h, k) => (h ? flush() : run.push(...pts.slice(k * POINT_STRIDE, k * POINT_STRIDE + POINT_STRIDE))))
  flush()
  return pieces
}

/** 前回の位置から今回の位置まで、半径の半分おきに消しゴムを当てる点（速くなぞっても線を飛び越さない） */
export function eraserPath(from: Point | null, to: Point, radius: number): Point[] {
  if (!from) return [to]
  const n = Math.floor(Math.hypot(to.x - from.x, to.y - from.y) / (radius / 2))
  const out: Point[] = []
  for (let k = 1; k <= n; k++) out.push({ x: from.x + ((to.x - from.x) * k) / (n + 1), y: from.y + ((to.y - from.y) * k) / (n + 1) })
  out.push(to)
  return out
}

/** すべての線に消しゴムを当てた結果。変化がなければ null */
export function eraseStrokes(strokes: Stroke[], points: Point[], radius: number): Stroke[] | null {
  let current = strokes
  let changed = false
  for (const p of points) {
    const next: Stroke[] = []
    for (const s of current) {
      const pieces = eraseStroke(s, p.x, p.y, radius)
      if (pieces) {
        changed = true
        next.push(...pieces)
      } else {
        next.push(s)
      }
    }
    current = next
  }
  return changed ? current : null
}

/** 点が多角形の内側か（偶奇判定） */
export function pointInPolygon(x: number, y: number, polygon: Point[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** 投げ縄で囲んだ線（点の50%以上が内側）の id */
export function lassoSelect(strokes: Stroke[], polygon: Point[]): string[] {
  if (polygon.length < 3) return []
  const ids: string[] = []
  for (const s of strokes) {
    let inside = 0
    const n = s.points.length / POINT_STRIDE
    for (let i = 0; i < s.points.length; i += POINT_STRIDE) if (pointInPolygon(s.points[i], s.points[i + 1], polygon)) inside++
    if (n && inside / n >= 0.5) ids.push(s.id)
  }
  return ids
}

export function translateStroke(s: Stroke, dx: number, dy: number): Stroke {
  const points = s.points.slice()
  for (let i = 0; i < points.length; i += POINT_STRIDE) {
    points[i] += dx
    points[i + 1] += dy
  }
  return { ...s, points }
}

/**
 * 直線化の判定（内部仕様書 6.4）。
 * 最後に動いてから holdMs 以上たち、線の始点から終点まで minLength 以上あれば直線にする
 */
export function shouldSnapLine(points: number[], lastMoveAt: number, now: number, holdMs: number, minLength: number): boolean {
  if (points.length < POINT_STRIDE * 2 || now - lastMoveAt < holdMs) return false
  const x0 = points[0], y0 = points[1]
  const x1 = points[points.length - 4], y1 = points[points.length - 3]
  return Math.hypot(x1 - x0, y1 - y0) >= minLength
}

/** 線を始点と終点の2点にする。筆圧は平均値 */
export function toLine(points: number[]): number[] {
  let sum = 0
  for (let i = 2; i < points.length; i += POINT_STRIDE) sum += points[i]
  const avg = sum / (points.length / POINT_STRIDE)
  const n = points.length
  return [points[0], points[1], avg, points[3], points[n - 4], points[n - 3], avg, points[n - 1]]
}
