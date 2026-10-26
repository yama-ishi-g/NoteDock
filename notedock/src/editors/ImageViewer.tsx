import { useCallback, useEffect, useRef, useState } from 'react'
import ZoomViewport from '../components/ZoomViewport'
import type { InkSidecar } from '../formats/inkSidecar'
import InkToolbar from '../ink/InkToolbar'
import type { Stroke } from '../ink/model'
import { useInkSession } from '../ink/useInkSession'
import { loadSidecar } from '../services/annotations'
import { readEntry } from '../services/files'
import { useAppStore } from '../state/appStore'
import PageInk from './PageInk'
import { useSidecarSave } from './useSidecarSave'
import ZoomControls from './ZoomControls'

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const PAD = 16

/** 画像の表示と書き込み（S06）。座標は画像のピクセル */
export default function ImageViewer({ projectId, path }: { projectId: string; path: string }) {
  const readOnly = useAppStore((s) => s.readOnly)
  const session = useInkSession()
  const { setLoaded, pageStrokes, update } = useSidecarSave(projectId, path)
  const [image, setImage] = useState<{ url: string; width: number; height: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const fitted = useRef(false)

  useEffect(() => {
    let url: string | null = null
    let cancelled = false
    ;(async () => {
      try {
        const file = await readEntry(projectId, path)
        const bmp = await createImageBitmap(file)
        const size = { width: bmp.width, height: bmp.height }
        bmp.close()
        const sc: InkSidecar = await loadSidecar(projectId, path, 'image-px')
        if (cancelled) return
        url = URL.createObjectURL(file)
        setLoaded(sc)
        setImage({ url, ...size })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [projectId, path, setLoaded])

  const fitZoom = useCallback((el: HTMLElement) => {
    if (!image) return 1
    const z = Math.min((el.clientWidth - PAD * 2) / image.width, (el.clientHeight - PAD * 2) / image.height)
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
  }, [image])
  const fit = () => scroller && setZoom(fitZoom(scroller))

  // 表示領域ができたら、画面に収まる倍率にする
  const onScroller = useCallback((el: HTMLDivElement | null) => {
    setScroller(el)
    if (el && !fitted.current) {
      fitted.current = true
      setZoom(fitZoom(el))
    }
  }, [fitZoom])

  const onChange = useCallback((_key: string, s: Stroke[]) => {
    if (image) update('0', { width: image.width, height: image.height }, s)
  }, [image, update])

  if (error) return <div className="editor-message">画像を開けませんでした: {error}</div>
  if (!image) return <div className="editor-message">読み込み中…</div>

  const w = image.width * zoom
  const h = image.height * zoom
  return (
    <div className="viewer">
      <div className="viewer-bar">
        <InkToolbar state={session.tools} onChange={session.changeTools} canUndo={session.activeHistory.canUndo} canRedo={session.activeHistory.canRedo} onUndo={session.undo} onRedo={session.redo} />
        <ZoomControls zoom={zoom} onZoom={setZoom} onFit={fit} min={MIN_ZOOM} max={MAX_ZOOM} />
      </div>
      <ZoomViewport
        zoom={zoom}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        onZoom={setZoom}
        contentWidth={w + PAD * 2}
        contentHeight={h + PAD * 2}
        fingerDraw={session.tools.finger}
        penActive={session.penActive}
        cancelTouch={session.cancelTouch}
        onScroller={onScroller}
      >
        <div className="image-page" style={{ width: w, height: h, left: PAD, top: PAD }}>
          <img src={image.url} alt={path} draggable={false} />
          <PageInk
            pageKey="0"
            width={w}
            height={h}
            logicalWidth={image.width}
            getStrokes={() => pageStrokes('0')}
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
        </div>
      </ZoomViewport>
    </div>
  )
}
