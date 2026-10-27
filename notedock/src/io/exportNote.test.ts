import { describe, expect, it } from 'vitest'
import { inkPdfPageTops } from './exportNote'

describe('手書きノートのPDF', () => {
  it('描いた所までを A4 縦のページに分ける', () => {
    expect(inkPdfPageTops(500, 1414)).toEqual([0])
    expect(inkPdfPageTops(1414, 1414)).toEqual([0])
    expect(inkPdfPageTops(1500, 1414)).toEqual([0, 1414])
    expect(inkPdfPageTops(0, 1414)).toEqual([0])
    // 既定は横幅1000に対する A4 の高さ
    expect(inkPdfPageTops(3000)).toHaveLength(3)
  })
})
