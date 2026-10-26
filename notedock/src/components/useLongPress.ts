import { useRef } from 'react'

/** 長押し（タッチ・ペン）で onLongPress を呼ぶ。動いたら取り消す */
export function useLongPress(onLongPress: (pos: { x: number; y: number }) => void, ms = 500) {
  const timer = useRef<number | undefined>(undefined)
  const start = useRef({ x: 0, y: 0 })
  const fired = useRef(false)
  const cancel = () => window.clearTimeout(timer.current)
  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false
      if (e.pointerType === 'mouse') return
      start.current = { x: e.clientX, y: e.clientY }
      const pos = { x: e.clientX, y: e.clientY }
      timer.current = window.setTimeout(() => {
        fired.current = true
        onLongPress(pos)
      }, ms)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      if (!fired.current) onLongPress({ x: e.clientX, y: e.clientY })
    },
    /** 長押しの後の click を無視するために使う */
    wasLongPress: () => fired.current,
  }
}
