import type { PDFDocumentLoadingTask } from 'pdfjs-dist'

// pdf.js は大きいので、PDF を開くときに読み込む。cMap（日本語）・標準フォント・wasm は同梱したものを使う（オフライン対応）
const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`

let loaded: Promise<typeof import('pdfjs-dist')> | null = null

export function loadPdfjs() {
  loaded ??= (async () => {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
    return pdfjs
  })()
  return loaded
}

export async function openPdf(data: Uint8Array, onPassword: (retry: boolean) => Promise<string | null>): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({
    data,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    iccUrl: `${ASSETS}iccs/`,
  })
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    // reason 2 = パスワードが違う
    onPassword(reason === 2).then((pw) => {
      if (pw === null) void task.destroy()
      else update(pw)
    })
  }
  return task
}
