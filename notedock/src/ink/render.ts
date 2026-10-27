import { getStroke } from 'perfect-freehand'
import { POINT_STRIDE, strokeBounds, type Rect, type Stroke } from './model'

// ストローク → 輪郭ポリゴン（perfect-freehand）→ Path2D / SVG パス（内部仕様書 6.3）

function outline(stroke: Stroke, complete: boolean): number[][] {
  const pts: number[][] = []
  for (let i = 0; i < stroke.points.length; i += POINT_STRIDE) pts.push([stroke.points[i], stroke.points[i + 1], stroke.points[i + 2]])
  const marker = stroke.tool === 'marker'
  const straight = stroke.isLine || !!stroke.shape
  return getStroke(pts, {
    size: stroke.size,
    thinning: marker || straight ? 0 : 0.6,
    smoothing: 0.5,
    streamline: straight ? 0 : 0.4,
    simulatePressure: false,
    last: complete,
    start: { cap: true },
    end: { cap: true },
  })
}

function quadPath(out: number[][], move: (x: number, y: number) => void, quad: (cx: number, cy: number, x: number, y: number) => void) {
  if (!out.length) return
  move(out[0][0], out[0][1])
  for (let i = 1; i < out.length; i++) {
    const [x0, y0] = out[i - 1]
    const [x1, y1] = out[i]
    quad(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
}

/** 1点だけの線（タップ）は丸を描く */
function dot(stroke: Stroke): Path2D {
  const p = new Path2D()
  const r = (stroke.size * (stroke.tool === 'marker' ? 1 : Math.max(0.4, stroke.points[2] ?? 0.5))) / 2
  p.arc(stroke.points[0], stroke.points[1], r, 0, Math.PI * 2)
  return p
}

export function strokePath(stroke: Stroke, complete = true): Path2D {
  if (stroke.points.length <= POINT_STRIDE) return dot(stroke)
  const path = new Path2D()
  quadPath(outline(stroke, complete), (x, y) => path.moveTo(x, y), (cx, cy, x, y) => path.quadraticCurveTo(cx, cy, x, y))
  path.closePath()
  return path
}

/** SVG の path 文字列（PDF への焼き込み・PNG 書き出しで使う） */
export function strokeSvgPath(stroke: Stroke): string {
  if (stroke.points.length <= POINT_STRIDE) {
    const r = stroke.size / 2
    const [x, y] = stroke.points
    return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`
  }
  const parts: string[] = []
  const f = (n: number) => Math.round(n * 100) / 100
  quadPath(outline(stroke, true), (x, y) => parts.push(`M ${f(x)} ${f(y)}`), (cx, cy, x, y) => parts.push(`Q ${f(cx)} ${f(cy)} ${f(x)} ${f(y)}`))
  parts.push('Z')
  return parts.join(' ')
}

// 確定した線の輪郭と外接矩形はキャッシュする（線のデータは書き換えないため、オブジェクトをキーにできる）
const pathCache = new WeakMap<Stroke, Path2D>()
const boundsCache = new WeakMap<Stroke, Rect>()

export function cachedPath(stroke: Stroke): Path2D {
  let p = pathCache.get(stroke)
  if (!p) {
    p = strokePath(stroke)
    pathCache.set(stroke, p)
  }
  return p
}

export function cachedBounds(stroke: Stroke): Rect {
  let b = boundsCache.get(stroke)
  if (!b) {
    b = strokeBounds(stroke)
    boundsCache.set(stroke, b)
  }
  return b
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, path: Path2D = cachedPath(stroke), alpha = 1) {
  ctx.globalAlpha = stroke.opacity * alpha
  ctx.fillStyle = stroke.color
  ctx.fill(path)
  ctx.globalAlpha = 1
}
