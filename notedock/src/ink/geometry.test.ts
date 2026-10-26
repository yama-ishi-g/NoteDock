import { describe, expect, it } from 'vitest'
import { densify, eraseStroke, eraseStrokes, eraserPath, lassoSelect, pointInPolygon, shouldSnapLine, strokesInRect, toLine, transformStroke, translateStroke } from './geometry'
import { InkHistory } from './history'
import { roundStroke, type Stroke } from './model'

const line = (x0: number, y0: number, x1: number, y1: number, id = 's'): Stroke => ({
  id, tool: 'pen', color: '#000000', size: 4, opacity: 1, points: [x0, y0, 0.5, 0, x1, y1, 0.5, 100],
})

describe('densify', () => {
  it('点の間隔を step 以下にする', () => {
    const pts = densify([0, 0, 0.5, 0, 10, 0, 0.5, 10], 2)
    expect(pts.length / 4).toBe(6)
    expect(pts.slice(-4)).toEqual([10, 0, 0.5, 10])
  })
})

describe('eraseStroke（なぞった部分だけ消す）', () => {
  it('真ん中を消すと2本に分かれる', () => {
    const pieces = eraseStroke(line(0, 0, 100, 0), 50, 0, 5)!
    expect(pieces).toHaveLength(2)
    const maxX = Math.max(...pieces[0].points.filter((_, i) => i % 4 === 0))
    const minX = Math.min(...pieces[1].points.filter((_, i) => i % 4 === 0))
    expect(maxX).toBeLessThan(50 - 5)
    expect(minX).toBeGreaterThan(50 + 5)
    expect(pieces[0].id).not.toBe(pieces[1].id)
  })
  it('離れていれば null、全体を覆えば0本', () => {
    expect(eraseStroke(line(0, 0, 100, 0), 50, 40, 5)).toBeNull()
    expect(eraseStroke(line(0, 0, 4, 0), 2, 0, 20)).toEqual([])
  })
  it('直線化した線（2点）も途中で切れる', () => {
    const s = { ...line(0, 0, 200, 0), isLine: true }
    const pieces = eraseStroke(s, 100, 0, 10)!
    expect(pieces).toHaveLength(2)
    expect(pieces.every((p) => !p.isLine)).toBe(true)
  })
})

describe('eraserPath / eraseStrokes', () => {
  it('速く動かしても途中の点を補う', () => {
    const pts = eraserPath({ x: 0, y: 0 }, { x: 0, y: 100 }, 10)
    expect(pts.length).toBeGreaterThan(10)
    expect(pts.at(-1)).toEqual({ x: 0, y: 100 })
  })
  it('縦になぞると、横線2本がそれぞれ切れる', () => {
    const strokes = [line(-50, 30, 50, 30, 'a'), line(-50, 70, 50, 70, 'b')]
    const result = eraseStrokes(strokes, eraserPath({ x: 0, y: 0 }, { x: 0, y: 100 }, 10), 10)!
    expect(result).toHaveLength(4)
    expect(eraseStrokes(strokes, [{ x: 500, y: 500 }], 10)).toBeNull()
  })
})

describe('投げ縄', () => {
  const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
  it('点の内外判定', () => {
    expect(pointInPolygon(50, 50, square)).toBe(true)
    expect(pointInPolygon(150, 50, square)).toBe(false)
  })
  it('点の50%以上が内側の線を選ぶ', () => {
    const inside = line(10, 10, 90, 90, 'in')
    const half = { ...line(50, 50, 150, 50, 'half'), points: [50, 50, 0.5, 0, 90, 50, 0.5, 1, 150, 50, 0.5, 2, 160, 50, 0.5, 3] }
    const outside = line(200, 200, 300, 300, 'out')
    expect(lassoSelect([inside, half, outside], square)).toEqual(['in', 'half'])
  })
  it('移動', () => {
    expect(translateStroke(line(0, 0, 10, 10), 5, -5).points).toEqual([5, -5, 0.5, 0, 15, 5, 0.5, 100])
  })
})

describe('直線化', () => {
  const pts = [0, 0, 0.2, 0, 50, 3, 0.6, 50, 100, 0, 0.4, 100]
  it('止まって holdMs たち、十分な長さがあれば直線にする', () => {
    expect(shouldSnapLine(pts, 1000, 1600, 600, 20)).toBe(true)
    expect(shouldSnapLine(pts, 1000, 1500, 600, 20)).toBe(false)
    expect(shouldSnapLine([0, 0, 0.5, 0, 5, 0, 0.5, 10], 0, 1000, 600, 20)).toBe(false)
  })
  it('始点と終点の2点にし、筆圧は平均', () => {
    const l = toLine(pts)
    expect([l[0], l[1], l[3], l[4], l[5], l[7]]).toEqual([0, 0, 0, 100, 0, 100])
    expect(l[2]).toBeCloseTo(0.4)
    expect(l[6]).toBeCloseTo(0.4)
  })
})

describe('InkHistory', () => {
  it('元に戻す・やり直し', () => {
    const h = new InkHistory()
    const a: Stroke[] = []
    const b = [line(0, 0, 1, 1, 'b')]
    const c = [...b, line(0, 0, 2, 2, 'c')]
    h.record(a)
    h.record(b)
    expect(h.undo(c)).toBe(b)
    expect(h.undo(b)).toBe(a)
    expect(h.undo(a)).toBeNull()
    expect(h.redo(a)).toBe(b)
    expect(h.redo(b)).toBe(c)
    expect(h.canRedo).toBe(false)
  })
  it('新しい操作をするとやり直しは消える', () => {
    const h = new InkHistory()
    h.record([])
    h.undo([line(0, 0, 1, 1)])
    h.record([])
    expect(h.canRedo).toBe(false)
  })
})

describe('roundStroke', () => {
  it('座標・筆圧・時刻を丸める', () => {
    expect(roundStroke({ ...line(0, 0, 0, 0), points: [1.23456, 2.5, 0.123456, 10.6] }).points).toEqual([1.23, 2.5, 0.123, 11])
  })
})

describe('画像と一緒に動かす線', () => {
  it('点の半分以上が画像の中にある線だけを選ぶ', () => {
    const strokes = [line(10, 10, 90, 10, 'in'), line(50, 50, 250, 50, 'half'), line(150, 150, 300, 150, 'out')]
    expect(strokesInRect(strokes, { x: 0, y: 0, width: 100, height: 100 }).map((s) => s.id)).toEqual(['in', 'half'])
  })

  it('画像の左上を基準に、動かして拡大する（太さも）', () => {
    const s = transformStroke({ ...line(10, 20, 30, 20), size: 4 }, 0, 0, 100, 50, 2)
    expect([s.points[0], s.points[1]]).toEqual([120, 90])
    expect(s.size).toBe(8)
  })
})
