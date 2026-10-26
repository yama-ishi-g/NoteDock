import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ZoomViewport from '../components/ZoomViewport'
import InkToolbar from '../ink/InkToolbar'
import type { Stroke } from '../ink/model'
import { useInkSession } from '../ink/useInkSession'
import { sidecarAssets } from '../ink/assets'
import type { InkItem } from '../ink/items'
import { openPdf } from '../io/pdfjs'
import { loadSidecar } from '../services/annotations'
import { readEntry } from '../services/files'
import { reportError, useAppStore } from '../state/appStore'
import { dialogs } from '../state/dialogs'
import PageInk from './PageInk'
import { useSidecarSave } from './useSidecarSave'
import ZoomControls from './ZoomControls'

const MIN_ZOOM = 0.3
const MAX_ZOOM = 4
const PAD = 16
const GAP = 12
/** 1ページの Canvas の上限（iPad の Canvas の上限 約1677万画素より小さくする） */
const MAX_CANVAS_PIXELS = 8_000_000
const WARN_BYTES = 100 * 1024 * 1024
const WARN_PAGES = 300

type PageSize = { width: number; height: number }

type PageProps = {
  doc: PDFDocumentProxy
  index: number
  size: PageSize
  zoom: number
  top: number
  left: number
  scroller: HTMLElement | null
  ink: React.ReactNode
}

/** 1ページ。画面の近くに来たときだけ Canvas に描き、離れたら解放する */
const PdfPage = memo(function PdfPage({ doc, index, size, zoom, top, left, scroller, ink }: PageProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  // 拡大縮小の途中は描き直さず、止まってから描き直す
  const [renderZoom, setRenderZoom] = useState(zoom)

  useEffect(() => {
    const t = window.setTimeout(() => setRenderZoom(zoom), 200)
    return () => window.clearTimeout(t)
  }, [zoom])

  useEffect(() => {
    if (!scroller) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root: scroller, rootMargin: '100% 50%' })
    io.observe(boxRef.current!)
    return () => io.disconnect()
  }, [scroller])

  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current!
    let cancelled = false
    let task: { cancel(): void; promise: Promise<void> } | null = null
    ;(async () => {
      const page = await doc.getPage(index + 1)
      if (cancelled) return
      let scale = renderZoom * (window.devicePixelRatio || 1)
      if (size.width * size.height * scale * scale > MAX_CANVAS_PIXELS) scale = Math.sqrt(MAX_CANVAS_PIXELS / (size.width * size.height))
      const viewport = page.getViewport({ scale })
      // 描き終わるまで前の絵を残すため、別の Canvas に描いてから写す
      const off = document.createElement('canvas')
      off.width = Math.floor(viewport.width)
      off.height = Math.floor(viewport.height)
      task = page.render({ canvas: off, viewport })
      try {
        await task.promise
        if (cancelled) return
        canvas.width = off.width
        canvas.height = off.height
        canvas.getContext('2d')!.drawImage(off, 0, 0)
      } catch {
        // 描画の取り消し
      } finally {
        off.width = 0
        off.height = 0
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [visible, renderZoom, doc, index, size])

  // 画面から離れたら Canvas のメモリを解放する
  useEffect(() => {
    if (visible) return
    const c = canvasRef.current
    if (c) {
      c.width = 0
      c.height = 0
    }
  }, [visible])

  return (
    <div ref={boxRef} className="pdf-page" style={{ top, left, width: size.width * zoom, height: size.height * zoom }}>
      <canvas ref={canvasRef} />
      {visible && ink}
      <span className="pdf-page-no">{index + 1}</span>
    </div>
  )
})

/** PDF の表示と書き込み（S05）。座標はページごとに pdf.js の getViewport({ scale: 1 })（pt） */
export default function PdfViewer({ projectId, path }: { projectId: string; path: string }) {
  const appReadOnly = useAppStore((s) => s.readOnly)
  const session = useInkSession()
  const { setLoaded, pageStrokes, pageItems, update } = useSidecarSave(projectId, path)
  const assets = useMemo(() => sidecarAssets(projectId, path), [projectId, path])
  const imageInput = useRef<HTMLInputElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [encrypted, setEncrypted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState('読み込み中…')
  const [zoom, setZoom] = useState(1)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const fitted = useRef(false)
  const [current, setCurrent] = useState(1)
  const taskRef = useRef<PDFDocumentLoadingTask | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const file = await readEntry(projectId, path)
        if (file.size > WARN_BYTES) {
          const ok = await dialogs.confirm({ title: '大きいPDFです', message: `このPDFは ${(file.size / 1024 / 1024).toFixed(0)} MB あります。動作が遅くなる可能性があります。開きますか？`, okLabel: '開く' })
          if (!ok) {
            setError('開くのをやめました')
            return
          }
        }
        let askedPassword = false
        const task = await openPdf(new Uint8Array(await file.arrayBuffer()), async (retry) => {
          askedPassword = true
          return dialogs.prompt({ title: retry ? 'パスワードが違います' : 'パスワード付きのPDFです', label: 'パスワード', okLabel: '開く' })
        })
        taskRef.current = task
        const pdf = await task.promise
        if (cancelled) return
        if (pdf.numPages > WARN_PAGES) {
          const ok = await dialogs.confirm({ title: 'ページ数の多いPDFです', message: `${pdf.numPages} ページあります。動作が遅くなる可能性があります。開きますか？`, okLabel: '開く' })
          if (!ok) {
            setError('開くのをやめました')
            return
          }
        }
        const list: PageSize[] = []
        for (let i = 1; i <= pdf.numPages; i++) {
          const vp = (await pdf.getPage(i)).getViewport({ scale: 1 })
          list.push({ width: vp.width, height: vp.height })
          if (i % 20 === 0) setProgress(`読み込み中… ${i} / ${pdf.numPages}`)
        }
        setLoaded(await loadSidecar(projectId, path, 'pdf-page'))
        if (cancelled) return
        setEncrypted(askedPassword)
        setSizes(list)
        setDoc(pdf)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      void taskRef.current?.destroy()
    }
  }, [projectId, path, setLoaded])

  const maxWidth = useMemo(() => Math.max(1, ...sizes.map((s) => s.width)), [sizes])
  // 各ページの位置（倍率1）
  const offsets = useMemo(() => {
    const out: number[] = []
    let y = 0
    for (const s of sizes) {
      out.push(y)
      y += s.height
    }
    return out
  }, [sizes])
  const totalHeight = (sizes.length ? offsets[offsets.length - 1] + sizes[sizes.length - 1].height : 0) * zoom + GAP * Math.max(0, sizes.length - 1) + PAD * 2
  const contentWidth = maxWidth * zoom + PAD * 2
  const pageTop = (i: number) => PAD + offsets[i] * zoom + GAP * i

  const fitZoom = useCallback((el: HTMLElement) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (el.clientWidth - PAD * 2) / maxWidth)), [maxWidth])
  const fit = () => scroller && setZoom(fitZoom(scroller))

  // 表示領域ができたら、ページの幅に合わせる
  const onScroller = useCallback((el: HTMLDivElement | null) => {
    setScroller(el)
    if (el && !fitted.current) {
      fitted.current = true
      setZoom(fitZoom(el))
    }
  }, [fitZoom])

  const onScroll = () => {
    if (!scroller || !sizes.length) return
    const y = scroller.scrollTop + scroller.clientHeight / 3
    let lo = 0
    for (let i = 0; i < sizes.length; i++) if (pageTop(i) <= y) lo = i
    setCurrent(lo + 1)
  }

  const jump = async () => {
    const v = await dialogs.prompt({
      title: 'ページへ移動',
      label: `ページ番号（1〜${sizes.length}）`,
      initial: String(current),
      okLabel: '移動',
      validate: (s) => (/^\d+$/.test(s) && +s >= 1 && +s <= sizes.length ? null : `1〜${sizes.length} の数字を入力してください`),
    })
    if (v && scroller) scroller.scrollTo({ top: pageTop(+v - 1) - PAD })
  }

  const onChange = useCallback((key: string, strokes: Stroke[], items: InkItem[]) => {
    const i = Number(key)
    update(key, sizes[i], strokes, items)
  }, [sizes, update])

  if (error) return <div className="editor-message">PDFを開けませんでした: {error}</div>
  if (!doc) return <div className="editor-message">{progress}</div>

  const readOnly = appReadOnly || encrypted
  return (
    <div className="viewer">
      <div className="viewer-bar">
        {!encrypted && (
          <InkToolbar state={session.tools} onChange={session.changeTools} canUndo={session.activeHistory.canUndo} canRedo={session.activeHistory.canRedo} onUndo={session.undo} onRedo={session.redo} onInsertImage={() => imageInput.current?.click()} />
        )}
        {encrypted && <span className="muted small viewer-note">パスワード付きのPDFには書き込めません</span>}
        <div className="zoom-controls">
          <button className="btn small" onClick={jump}>{current} / {sizes.length}</button>
        </div>
        <ZoomControls zoom={zoom} onZoom={setZoom} onFit={fit} min={MIN_ZOOM} max={MAX_ZOOM} />
      </div>
      <ZoomViewport
        zoom={zoom}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onZoom={setZoom}
        contentWidth={contentWidth}
        contentHeight={totalHeight}
        fingerDraw={session.tools.finger}
        penActive={session.penActive}
        cancelTouch={session.cancelTouch}
        onScroller={onScroller}
        onScroll={onScroll}
      >
        {sizes.map((s, i) => (
          <PdfPage
            key={i}
            doc={doc}
            index={i}
            size={s}
            zoom={zoom}
            top={pageTop(i)}
            left={(contentWidth - s.width * zoom) / 2}
            scroller={scroller}
            ink={
              <PageInk
                pageKey={String(i)}
                width={s.width * zoom}
                height={s.height * zoom}
                logicalWidth={s.width}
                getStrokes={() => pageStrokes(String(i))}
                getItems={() => pageItems(String(i))}
                assets={assets}
                textStyle={session.textStyle}
                tool={session.tools.tool}
                penColor={session.tools.penColor}
                finger={session.tools.finger}
                holdMs={session.holdMs}
                readOnly={readOnly}
                scroller={scroller}
                onEngine={session.onEngine}
                onChange={onChange}
                onHistory={session.onHistory}
              />
            }
          />
        ))}
      </ZoomViewport>
      <input ref={imageInput} type="file" accept="image/*,.heic,.heif" hidden onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) session.insertImage(f).catch((err) => reportError(err, '画像を置けませんでした: '))
      }} />
    </div>
  )
}
