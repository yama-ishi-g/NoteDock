import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'

// PDF・画像の表示領域。指1本でスクロール（「指で描く」のときは描画）、指2本でピンチ拡大縮小、
// Ctrl＋ホイールで拡大縮小（内部仕様書 6.7）。ペンで描いている間は指の操作を無視する（手のひら対策）

type Props = {
  zoom: number
  minZoom: number
  maxZoom: number
  onZoom: (zoom: number) => void
  /** 現在の倍率での中身の大きさ（px） */
  contentWidth: number
  contentHeight: number
  fingerDraw: boolean
  penActive: () => boolean
  cancelTouch: () => void
  onScroller?: (el: HTMLDivElement | null) => void
  onScroll?: () => void
  children: ReactNode
}

const INERTIA_FRICTION = 0.92
const INERTIA_MIN_SPEED = 0.03
const INERTIA_MAX_SPEED = 4

type Anchor = { contentX: number; contentY: number; clientX: number; clientY: number }

export default function ZoomViewport({ zoom, minZoom, maxZoom, onZoom, contentWidth, contentHeight, fingerDraw, penActive, cancelTouch, onScroller, onScroll, children }: Props) {
  const viewRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pan = useRef<{ id: number; samples: { t: number; dx: number; dy: number }[] } | null>(null)
  const pinch = useRef<{ dist0: number; zoom0: number; contentX: number; contentY: number } | null>(null)
  const anchor = useRef<Anchor | null>(null)
  const prevZoom = useRef(zoom)
  const inertia = useRef(0)
  const live = useRef({ zoom, minZoom, maxZoom, onZoom, fingerDraw, penActive, cancelTouch })
  useEffect(() => {
    live.current = { zoom, minZoom, maxZoom, onZoom, fingerDraw, penActive, cancelTouch }
  })

  useEffect(() => {
    onScroller?.(viewRef.current)
    return () => onScroller?.(null)
  }, [onScroller])

  const clamp = (z: number) => Math.min(live.current.maxZoom, Math.max(live.current.minZoom, z))

  /** 画面上の点 (clientX, clientY) が指している中身の位置（倍率1の座標）を覚えて、拡大縮小する */
  const zoomAt = (z: number, clientX: number, clientY: number) => {
    const inner = innerRef.current!.getBoundingClientRect()
    const cur = live.current.zoom
    anchor.current = { contentX: (clientX - inner.left) / cur, contentY: (clientY - inner.top) / cur, clientX, clientY }
    live.current.onZoom(clamp(z))
  }

  // 拡大縮小の後、基準の点が同じ場所に来るようにスクロールする
  useLayoutEffect(() => {
    const view = viewRef.current!
    const a = anchor.current
    if (a) {
      const inner = innerRef.current!.getBoundingClientRect()
      view.scrollLeft += inner.left + a.contentX * zoom - a.clientX
      view.scrollTop += inner.top + a.contentY * zoom - a.clientY
      anchor.current = null
    } else if (prevZoom.current !== zoom) {
      // ボタンでの拡大縮小は、画面の中央を基準にする
      const r = prevZoom.current
      const cx = (view.scrollLeft + view.clientWidth / 2) / r
      const cy = (view.scrollTop + view.clientHeight / 2) / r
      view.scrollLeft = cx * zoom - view.clientWidth / 2
      view.scrollTop = cy * zoom - view.clientHeight / 2
    }
    prevZoom.current = zoom
  }, [zoom])

  useEffect(() => {
    const view = viewRef.current!
    const stopInertia = () => {
      cancelAnimationFrame(inertia.current)
      inertia.current = 0
    }
    const startInertia = (samples: { t: number; dx: number; dy: number }[]) => {
      const now = performance.now()
      const recent = samples.filter((s) => now - s.t < 100)
      if (recent.length < 2) return
      const dt = Math.max(16, now - recent[0].t)
      const c = (v: number) => Math.max(-INERTIA_MAX_SPEED, Math.min(INERTIA_MAX_SPEED, v))
      let vx = c(recent.reduce((s, p) => s + p.dx, 0) / dt)
      let vy = c(recent.reduce((s, p) => s + p.dy, 0) / dt)
      let last = now
      const step = (t: number) => {
        const el = t - last
        last = t
        const k = Math.pow(INERTIA_FRICTION, el / 16)
        vx *= k
        vy *= k
        if (Math.hypot(vx, vy) < INERTIA_MIN_SPEED) {
          inertia.current = 0
          return
        }
        view.scrollLeft -= vx * el
        view.scrollTop -= vy * el
        inertia.current = requestAnimationFrame(step)
      }
      inertia.current = requestAnimationFrame(step)
    }
    const startPinch = () => {
      const [a, b] = [...pointers.current.values()]
      const inner = innerRef.current!.getBoundingClientRect()
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      const z = live.current.zoom
      pinch.current = { dist0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), zoom0: z, contentX: (cx - inner.left) / z, contentY: (cy - inner.top) / z }
      pan.current = null
      live.current.cancelTouch()
    }

    const onDown = (e: PointerEvent) => {
      stopInertia()
      if (e.pointerType !== 'touch') return
      if (live.current.penActive()) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.current.size === 2) startPinch()
      else if (pointers.current.size === 1 && !live.current.fingerDraw) pan.current = { id: e.pointerId, samples: [] }
    }
    const onMove = (e: PointerEvent) => {
      const prev = pointers.current.get(e.pointerId)
      if (!prev) return
      if (live.current.penActive()) {
        // ペンを使い始めたら、指の操作はやめる
        pointers.current.clear()
        pan.current = null
        pinch.current = null
        return
      }
      const cur = { x: e.clientX, y: e.clientY }
      pointers.current.set(e.pointerId, cur)
      const p = pinch.current
      if (p && pointers.current.size >= 2) {
        const [a, b] = [...pointers.current.values()]
        const cx = (a.x + b.x) / 2
        const cy = (a.y + b.y) / 2
        const z = clamp(p.zoom0 * (Math.hypot(a.x - b.x, a.y - b.y) / p.dist0))
        anchor.current = { contentX: p.contentX, contentY: p.contentY, clientX: cx, clientY: cy }
        if (Math.abs(z - live.current.zoom) > 0.001) live.current.onZoom(z)
        else {
          // 倍率が変わらなくても、2本指の移動でスクロールする
          const inner = innerRef.current!.getBoundingClientRect()
          view.scrollLeft += inner.left + p.contentX * z - cx
          view.scrollTop += inner.top + p.contentY * z - cy
        }
      } else if (pan.current?.id === e.pointerId) {
        const dx = cur.x - prev.x
        const dy = cur.y - prev.y
        view.scrollLeft -= dx
        view.scrollTop -= dy
        const now = performance.now()
        pan.current.samples.push({ t: now, dx, dy })
        pan.current.samples = pan.current.samples.filter((s) => now - s.t < 100)
      }
    }
    const onUp = (e: PointerEvent) => {
      if (!pointers.current.delete(e.pointerId)) return
      if (pinch.current && pointers.current.size < 2) {
        pinch.current = null
        // 残った1本の指はスクロールに使わない（意図しない移動を防ぐ）
        pan.current = null
      } else if (pan.current?.id === e.pointerId) {
        startInertia(pan.current.samples)
        pan.current = null
      }
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomAt(live.current.zoom * Math.exp(-e.deltaY * 0.002), e.clientX, e.clientY)
    }
    view.addEventListener('pointerdown', onDown)
    view.addEventListener('pointermove', onMove)
    view.addEventListener('pointerup', onUp)
    view.addEventListener('pointercancel', onUp)
    view.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      stopInertia()
      view.removeEventListener('pointerdown', onDown)
      view.removeEventListener('pointermove', onMove)
      view.removeEventListener('pointerup', onUp)
      view.removeEventListener('pointercancel', onUp)
      view.removeEventListener('wheel', onWheel)
    }
    // zoomAt・clamp は live を読むだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={viewRef} className="zoom-viewport" onScroll={onScroll}>
      <div ref={innerRef} className="zoom-inner" style={{ width: contentWidth, height: contentHeight }}>
        {children}
      </div>
    </div>
  )
}
