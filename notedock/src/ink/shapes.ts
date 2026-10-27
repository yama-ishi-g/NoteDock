import { newStrokeId, type Point, type ShapeKind, type Stroke } from './model'

// 図形（円・長方形・矢印）を線にする。ふつうの線と同じく、消しゴム・投げ縄・書き出しがそのまま使える

/** 図形の点の間隔（消しゴムで途中を消せるよう、細かく区切る） */
const STEP = 6
const ARROW_ANGLE = (28 * Math.PI) / 180

type Base = Pick<Stroke, 'color' | 'size'>

function polyline(pts: Point[], closed: boolean): number[] {
  const list = closed ? [...pts, pts[0]] : pts
  const out: number[] = []
  list.forEach((p, i) => {
    if (i === 0) {
      out.push(p.x, p.y, 0.5, 0)
      return
    }
    const q = list[i - 1]
    const n = Math.max(1, Math.ceil(Math.hypot(p.x - q.x, p.y - q.y) / STEP))
    for (let k = 1; k <= n; k++) out.push(q.x + ((p.x - q.x) * k) / n, q.y + ((p.y - q.y) * k) / n, 0.5, 0)
  })
  return out
}

function ellipse(a: Point, b: Point): Point[] {
  const cx = (a.x + b.x) / 2
  const cy = (a.y + b.y) / 2
  const rx = Math.abs(b.x - a.x) / 2
  const ry = Math.abs(b.y - a.y) / 2
  // 周の長さ（近似）から分割数を決める
  const n = Math.max(24, Math.min(240, Math.ceil((Math.PI * (rx + ry)) / STEP)))
  const pts: Point[] = []
  for (let k = 0; k < n; k++) {
    const t = (k / n) * Math.PI * 2 - Math.PI / 2
    pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) })
  }
  return pts
}

/** a から b までドラッグした図形の線（矢印は軸と矢じりの2本） */
export function shapeStrokes(kind: ShapeKind, a: Point, b: Point, base: Base): Stroke[] {
  const make = (points: number[]): Stroke => ({ id: newStrokeId(), tool: 'pen', opacity: 1, ...base, points, shape: kind })
  if (kind === 'ellipse') return [make(polyline(ellipse(a, b), true))]
  if (kind === 'rect') return [make(polyline([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], true))]
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  const head = Math.min(len * 0.4, 16 + base.size * 3)
  const angle = Math.atan2(b.y - a.y, b.x - a.x)
  const wing = (d: number) => ({ x: b.x - head * Math.cos(angle + d), y: b.y - head * Math.sin(angle + d) })
  return [make(polyline([a, b], false)), make(polyline([wing(ARROW_ANGLE), b, wing(-ARROW_ANGLE)], false))]
}
