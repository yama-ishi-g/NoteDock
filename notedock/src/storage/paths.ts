// パスは OPFS ルートからの相対パス（'/' 区切り）で扱う

// Windows でも扱えない文字と制御文字
// oxlint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/

export const MAX_NAME_LENGTH = 100

/** ファイル・フォルダ・プロジェクトの名前を検証する。問題があればメッセージを返す */
export function validateName(name: string): string | null {
  if (!name.trim()) return '名前を入力してください'
  if (name.length > MAX_NAME_LENGTH) return `名前は${MAX_NAME_LENGTH}文字以内にしてください`
  if (FORBIDDEN.test(name)) return '次の文字は使えません: \\ / : * ? " < > |'
  if (name === '.' || name === '..') return 'この名前は使えません'
  if (/[ .]$/.test(name) || /^ /.test(name)) return '名前の先頭・末尾に空白、末尾にピリオドは使えません'
  if (name.endsWith('.tmp')) return '拡張子 .tmp は使えません'
  return null
}

export function joinPath(...parts: string[]): string {
  return parts
    .flatMap((p) => p.split('/'))
    .filter((p) => p && p !== '.')
    .join('/')
}

/** パスを正規化する。'..' を含むパスは拒否する */
export function normalizePath(path: string): string {
  const parts = path.split('/').filter((p) => p && p !== '.')
  if (parts.some((p) => p === '..')) throw new Error(`不正なパスです: ${path}`)
  return parts.join('/')
}

export function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** 拡張子（小文字、ドットなし）。なければ '' */
export function extname(name: string): string {
  const base = basename(name)
  const i = base.lastIndexOf('.')
  return i <= 0 ? '' : base.slice(i + 1).toLowerCase()
}

/** 拡張子を除いた名前 */
export function stem(name: string): string {
  const base = basename(name)
  const i = base.lastIndexOf('.')
  return i <= 0 ? base : base.slice(0, i)
}

/** 'メモ.txt' → 'メモ (2).txt'。exists が偽になる名前を返す */
export function uniqueName(name: string, exists: (candidate: string) => boolean): string {
  if (!exists(name)) return name
  const ext = extname(name)
  const base = ext ? name.slice(0, -(ext.length + 1)) : name
  const m = /^(.*) \((\d+)\)$/.exec(base)
  const root = m ? m[1] : base
  for (let n = m ? Number(m[2]) + 1 : 2; ; n++) {
    const candidate = `${root} (${n})${ext ? `.${ext}` : ''}`
    if (!exists(candidate)) return candidate
  }
}

/** 手書きの付属ファイル名（xxx.pdf → xxx.pdf.ink.json） */
export const SIDECAR_SUFFIX = '.ink.json'
export const sidecarOf = (path: string) => `${path}${SIDECAR_SUFFIX}`
export const isSidecar = (name: string) => name.endsWith(SIDECAR_SUFFIX)
export const TMP_SUFFIX = '.tmp'
