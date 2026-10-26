import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { setResult } from './report'

// 0-10 pdf.js の表示（日本語・大きいPDF・ページの仮想化）
const ASSETS = `${import.meta.env.BASE_URL}pdfjs/`
// 1ページのCanvasの最大画素数（iPadのCanvas上限 約1677万画素より小さく抑える）
const MAX_CANVAS_PIXELS = 8_000_000

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return pdfjs
}

type PageSize = { width: number; height: number }

function PdfPage({ doc, index, size, zoom, root, onRendered, onLive }: {
  doc: PDFDocumentProxy
  root: HTMLElement | null
  index: number
  size: PageSize
  zoom: number
  onRendered: (ms: number) => void
  onLive: (delta: number) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root, rootMargin: '100% 0px' })
    io.observe(boxRef.current!)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current!
    let cancelled = false
    let task: { cancel(): void; promise: Promise<void> } | null = null
    onLive(1)
    ;(async () => {
      const page = await doc.getPage(index + 1)
      if (cancelled) return
      let scale = zoom * (window.devicePixelRatio || 1)
      const base = page.getViewport({ scale: 1 })
      if (base.width * base.height * scale * scale > MAX_CANVAS_PIXELS) {
        scale = Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height))
      }
      const viewport = page.getViewport({ scale })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const t = performance.now()
      task = page.render({ canvas, viewport })
      try {
        await task.promise
        if (!cancelled) onRendered(performance.now() - t)
      } catch {
        // 描画のキャンセル
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
      // 画面外になったらCanvasのメモリを解放する
      canvas.width = 0
      canvas.height = 0
      onLive(-1)
    }
  }, [visible, zoom, doc, index, onRendered, onLive])

  return (
    <div ref={boxRef} style={{ width: size.width * zoom, height: size.height * zoom, margin: '0 auto 12px', background: '#fff', boxShadow: '0 0 0 1px var(--border)', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
      <span style={{ position: 'absolute', right: 6, bottom: 4, fontSize: 11, color: '#888' }}>{index + 1}</span>
    </div>
  )
}

export default function PdfSection() {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [zoom, setZoom] = useState(0.6)
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')
  const [renderTimes, setRenderTimes] = useState<number[]>([])
  const [live, setLive] = useState(0)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const onRendered = useCallback((ms: number) => setRenderTimes((prev) => [...prev.slice(-29), ms]), [])
  const onLive = useCallback((d: number) => setLive((n) => n + d), [])

  const taskRef = useRef<PDFDocumentLoadingTask | null>(null)
  useEffect(() => () => void taskRef.current?.destroy(), [])

  useEffect(() => {
    if (!renderTimes.length) return
    const avg = renderTimes.reduce((s, v) => s + v, 0) / renderTimes.length
    setResult('0-10 描画', `平均 ${avg.toFixed(0)}ms/ページ（直近${renderTimes.length}ページ）`)
  }, [renderTimes])

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    void taskRef.current?.destroy()
    setDoc(null)
    setSizes([])
    setRenderTimes([])
    try {
      const t = performance.now()
      const pdfjs = await loadPdfjs()
      const task = pdfjs.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
        cMapUrl: `${ASSETS}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${ASSETS}standard_fonts/`,
        wasmUrl: `${ASSETS}wasm/`,
        iccUrl: `${ASSETS}iccs/`,
      })
      taskRef.current = task
      task.onPassword = (update: (pw: string) => void) => {
        const pw = window.prompt('このPDFのパスワード')
        if (pw !== null) update(pw)
      }
      const pdf = await task.promise
      // ページの大きさを先に取得して、描画前でもスクロール位置が決まるようにする
      const list: PageSize[] = []
      for (let i = 1; i <= pdf.numPages; i++) {
        const vp = (await pdf.getPage(i)).getViewport({ scale: 1 })
        list.push({ width: vp.width, height: vp.height })
      }
      const ms = performance.now() - t
      setSizes(list)
      setDoc(pdf)
      const text = `${file.name} ${(file.size / 1024 / 1024).toFixed(1)}MB ${pdf.numPages}ページ 読み込み${ms.toFixed(0)}ms`
      setInfo(text)
      setResult('0-10 PDF', text)
    } catch (err) {
      setError(String(err))
      setResult('0-10 PDF', `失敗 ${file.name}: ${String(err)}`)
    }
  }

  return (
    <section id="lab-pdf">
      <h2>0-10 PDFの表示</h2>
      <div className="row">
        <label className="filebtn">PDFを開く<input type="file" accept="application/pdf,.pdf" onChange={onPick} /></label>
        <button onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.2).toFixed(1)))}>－</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(4, +(z + 0.2).toFixed(1)))}>＋</button>
      </div>
      <p className="hint">日本語のPDFが文字化けしないか / 100ページ以上のPDFをスクロールしてもSafariが落ちないか / 拡大しても文字がにじまないか</p>
      {info && <p className="hint">{info} ・ 描画中のページ {live} ・ 平均描画 {renderTimes.length ? (renderTimes.reduce((s, v) => s + v, 0) / renderTimes.length).toFixed(0) : '-'}ms</p>}
      {error && <p className="ng">{error}</p>}
      {doc && (
        <div ref={setScroller} style={{ height: 560, overflow: 'auto', background: 'var(--border)', borderRadius: 8, padding: 12 }}>
          {sizes.map((s, i) => (
            <PdfPage key={i} doc={doc} index={i} size={s} zoom={zoom} root={scroller} onRendered={onRendered} onLive={onLive} />
          ))}
        </div>
      )}
    </section>
  )
}
