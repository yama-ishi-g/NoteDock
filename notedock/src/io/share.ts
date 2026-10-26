// 書き出し: iPad では共有シート、それ以外（Windows など）はダウンロード

export type ShareResult = 'shared' | 'downloaded' | 'cancelled'

const MIME: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  zip: 'application/zip',
  notedock: 'application/zip',
  json: 'application/json',
}

export function mimeOf(name: string): string {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}

/** 正しい MIME タイプを付けた File を作る（画像なら共有シートに「画像を保存」が出る） */
export function makeFile(data: Blob | Uint8Array, name: string): File {
  return new File([data as BlobPart], name, { type: mimeOf(name) })
}

export function download(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/**
 * 共有シートで共有する。navigator.share はタップ直後でないと失敗するため、
 * 時間のかかる生成処理の後は、呼び出し側でもう一度タップしてもらう
 */
export async function shareFile(file: File): Promise<ShareResult> {
  const canShare = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  // Windows の Chrome / Edge も共有に対応しているが、PCではダウンロードの方が自然なため、タッチ端末のみ共有シートを使う
  const touchDevice = navigator.maxTouchPoints > 0
  if (canShare && touchDevice) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      // ユーザー操作の直後でない（NotAllowedError）などはダウンロードにする
      if (!(err instanceof DOMException && err.name === 'NotAllowedError')) throw err
    }
  }
  download(file)
  return 'downloaded'
}
