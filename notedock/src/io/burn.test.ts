import { describe, expect, it } from 'vitest'
import { burnedName, viewToPdfMatrix } from './burn'

// 表示座標 (vx, vy) を drawSvgPath（y 反転）→ 行列 の順に変換したときの PDF 座標
function toPdf(rotation: number, box: { x: number; y: number; width: number; height: number }, vx: number, vy: number) {
  const [a, b, c, d, e, f] = viewToPdfMatrix(rotation, box)
  const sx = vx
  const sy = -vy
  return [a * sx + c * sy + e, b * sx + d * sy + f].map((v) => Math.round(v * 1000) / 1000)
}

describe('viewToPdfMatrix', () => {
  const box = { x: 10, y: 20, width: 600, height: 800 }
  it('回転なし: 左上 → PDF の左上（x0, y0+h）', () => {
    expect(toPdf(0, box, 0, 0)).toEqual([10, 820])
    expect(toPdf(0, box, 600, 800)).toEqual([610, 20])
  })
  it('90度: 表示の左上は PDF の左下、右上は PDF の左上', () => {
    // 表示の幅は h=800、高さは w=600
    expect(toPdf(90, box, 0, 0)).toEqual([10, 20])
    expect(toPdf(90, box, 800, 0)).toEqual([10, 820])
  })
  it('180度: 表示の左上は PDF の右下', () => {
    expect(toPdf(180, box, 0, 0)).toEqual([610, 20])
    expect(toPdf(180, box, 600, 800)).toEqual([10, 820])
  })
  it('270度: 表示の左上は PDF の右上', () => {
    expect(toPdf(270, box, 0, 0)).toEqual([610, 820])
    expect(toPdf(270, box, 0, 600)).toEqual([10, 820])
  })
})

describe('burnedName', () => {
  it('「_書き込み」を付けるか、元の名前のまま', () => {
    expect(burnedName('資料.pdf', 'pdf', 'suffix')).toBe('資料_書き込み.pdf')
    expect(burnedName('資料.pdf', 'pdf', 'original')).toBe('資料.pdf')
    expect(burnedName('写真.webp', 'png', 'suffix')).toBe('写真_書き込み.png')
  })
})
