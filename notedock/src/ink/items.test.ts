import { describe, expect, it } from 'vitest'
import { fontSizeFor, migrateItems, newImageItem, newTextItem, wrapText } from './items'

// 1文字＝幅10として測る
const measure = (s: string) => [...s].length * 10

describe('items', () => {
  it('文字は枠の幅で折り返し、改行は残す', () => {
    expect(wrapText('あいうえおかき', 30, measure)).toEqual(['あいう', 'えおか', 'き'])
    expect(wrapText('ab\n\ncd', 100, measure)).toEqual(['ab', '', 'cd'])
    expect(wrapText('', 100, measure)).toEqual([''])
    // 1文字が枠より広くても1文字ずつは置く
    expect(wrapText('あい', 5, measure)).toEqual(['あ', 'い'])
  })

  it('文字の大きさは座標系の幅に合わせる', () => {
    expect(fontSizeFor(0, 1000)).toBe(18)
    expect(fontSizeFor(2, 1000)).toBe(44)
    expect(fontSizeFor(1, 600)).toBe(16.8)
    const t = newTextItem(10, 20, 2000, 1, '#ff0000')
    expect(t).toMatchObject({ x: 10, y: 20, w: 800, fontSize: 56, color: '#ff0000', text: '' })
  })

  it('画像は見えている範囲の中央に、幅の40%までで置く', () => {
    const big = newImageItem('a.jpg', 2000, 1000, { x: 0, y: 100, width: 1000, height: 600 }, 1000)
    expect(big).toMatchObject({ w: 400, h: 200, x: 300, y: 300 })
    const small = newImageItem('b.png', 100, 50, { x: 0, y: 0, width: 1000, height: 600 }, 1000)
    expect(small).toMatchObject({ w: 100, h: 50 })
  })

  it('読み込み時に壊れた要素を除く', () => {
    expect(migrateItems(undefined)).toEqual([])
    const ok = { id: 'a', type: 'text', x: 1, y: 2, w: 100, text: 'x', level: 1, fontSize: 28, color: '#000000' }
    expect(migrateItems([ok, null, { id: 'b', type: 'video', x: 0, y: 0 }, { id: 'c', type: 'image', x: 'x', y: 0 }])).toEqual([ok])
  })
})
