// テキストファイルの文字コード・改行コード・BOMの判定と復元

export type TextInfo = {
  encoding: 'utf-8' | 'shift_jis'
  bom: boolean
  eol: '\n' | '\r\n'
}

export type DecodedText = { text: string; info: TextInfo }

/** UTF-8 として厳密に読み、失敗したら Shift_JIS として読む。改行は '\n' にそろえて返す */
export function decodeText(bytes: Uint8Array): DecodedText {
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  let raw: string
  let encoding: TextInfo['encoding'] = 'utf-8'
  try {
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    raw = new TextDecoder('shift_jis').decode(bytes)
    encoding = 'shift_jis'
  }
  const crlf = (raw.match(/\r\n/g) ?? []).length
  const lf = (raw.match(/(?<!\r)\n/g) ?? []).length
  return {
    text: raw.replace(/\r\n?/g, '\n'),
    info: { encoding, bom, eol: crlf > lf ? '\r\n' : '\n' },
  }
}

/** 保存は常に UTF-8。読み込んだときの BOM と改行コードは保つ */
export function encodeText(text: string, info: Pick<TextInfo, 'bom' | 'eol'>): Uint8Array {
  const body = new TextEncoder().encode(info.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text)
  if (!info.bom) return body
  const out = new Uint8Array(body.length + 3)
  out.set([0xef, 0xbb, 0xbf])
  out.set(body, 3)
  return out
}

export const NEW_TEXT_INFO: TextInfo = { encoding: 'utf-8', bom: false, eol: '\n' }
