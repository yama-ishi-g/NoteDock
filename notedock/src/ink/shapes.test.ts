import { describe, expect, it } from 'vitest'
import { POINT_STRIDE, type Stroke } from './model'
import { shapeStrokes } from './shapes'

const base = { color: '#e24b4a', size: 4 }
const xy = (s: Stroke) => {
  const out: [number, number][] = []
  for (let i = 0; i < s.points.length; i += POINT_STRIDE) out.push([s.points[i], s.points[i + 1]])
  return out
}

describe('shapes', () => {
  it('長方形は4つの角を通って閉じる', () => {
    const [s] = shapeStrokes('rect', { x: 10, y: 20 }, { x: 110, y: 70 }, base)
    expect(s).toMatchObject({ tool: 'pen', color: '#e24b4a', size: 4, opacity: 1, shape: 'rect' })
    const pts = xy(s)
    expect(pts[0]).toEqual([10, 20])
    expect(pts.at(-1)).toEqual([10, 20])
    for (const c of [[110, 20], [110, 70], [10, 70]]) expect(pts).toContainEqual(c)
    // 消しゴムで途中を消せるよう、点の間隔は細かい
    for (let i = 1; i < pts.length; i++) expect(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])).toBeLessThanOrEqual(6.01)
  })

  it('円はドラッグした矩形に内接する', () => {
    const [s] = shapeStrokes('ellipse', { x: 0, y: 0 }, { x: 200, y: 100 }, base)
    for (const [x, y] of xy(s)) expect(((x - 100) / 100) ** 2 + ((y - 50) / 50) ** 2).toBeCloseTo(1, 1)
    const xs = xy(s).map((p) => p[0])
    expect(Math.min(...xs)).toBeCloseTo(0, 0)
    expect(Math.max(...xs)).toBeCloseTo(200, 0)
  })

  it('矢印は軸と矢じりの2本で、矢じりの先は終点', () => {
    const [shaft, head] = shapeStrokes('arrow', { x: 0, y: 0 }, { x: 100, y: 0 }, base)
    expect(xy(shaft)[0]).toEqual([0, 0])
    expect(xy(shaft).at(-1)).toEqual([100, 0])
    const h = xy(head)
    expect(h).toContainEqual([100, 0])
    expect(h[0][0]).toBeLessThan(100)
    expect(h[0][1]).toBeCloseTo(-h.at(-1)![1])
  })
})
