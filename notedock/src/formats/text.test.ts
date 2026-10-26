import { describe, expect, it } from 'vitest'
import { decodeText, encodeText } from './text'

describe('decodeText / encodeText', () => {
  it('UTF-8・LF', () => {
    const { text, info } = decodeText(new TextEncoder().encode('こんにちは\n世界'))
    expect(text).toBe('こんにちは\n世界')
    expect(info).toEqual({ encoding: 'utf-8', bom: false, eol: '\n' })
  })

  it('CRLF は LF にそろえ、保存時に CRLF に戻す', () => {
    const { text, info } = decodeText(new TextEncoder().encode('a\r\nb\r\n'))
    expect(text).toBe('a\nb\n')
    expect(info.eol).toBe('\r\n')
    expect(new TextDecoder().decode(encodeText(text, info))).toBe('a\r\nb\r\n')
  })

  it('BOM を保つ', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('メモ')])
    const { text, info } = decodeText(bytes)
    expect(text).toBe('メモ')
    expect(info.bom).toBe(true)
    expect([...encodeText(text, info)]).toEqual([...bytes])
  })

  it('Shift_JIS を判定して読み、保存は UTF-8', () => {
    // 「日本」の Shift_JIS
    const sjis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b])
    const { text, info } = decodeText(sjis)
    expect(text).toBe('日本')
    expect(info.encoding).toBe('shift_jis')
    expect(new TextDecoder().decode(encodeText(text, info))).toBe('日本')
  })
})
