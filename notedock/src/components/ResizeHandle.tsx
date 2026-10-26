import { useEffect, useRef } from 'react'

type Props = {
  className: string
  label: string
  /** ドラッグを始めたとき */
  onStart: () => void
  /** 始めた位置からの移動量（px） */
  onDrag: (dx: number, dy: number) => void
  onEnd?: () => void
}

/**
 * ブロックの大きさを変えるつまみ。指・ペン・マウスのどれでもドラッグできる。
 * iPadOS の文字選択などが動かないよう、touch イベントを止める
 */
export default function ResizeHandle({ className, label, onStart, onDrag, onEnd }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const live = useRef({ onStart, onDrag, onEnd })
  useEffect(() => {
    live.current = { onStart, onDrag, onEnd }
  })

  useEffect(() => {
    const el = ref.current!
    let start: { id: number; x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || start) return
      e.preventDefault()
      e.stopPropagation()
      el.setPointerCapture(e.pointerId)
      start = { id: e.pointerId, x: e.clientX, y: e.clientY }
      live.current.onStart()
    }
    const move = (e: PointerEvent) => {
      if (start?.id !== e.pointerId) return
      live.current.onDrag(e.clientX - start.x, e.clientY - start.y)
    }
    const up = (e: PointerEvent) => {
      if (start?.id !== e.pointerId) return
      start = null
      live.current.onEnd?.()
    }
    const touch = (e: TouchEvent) => e.preventDefault()
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('touchstart', touch, { passive: false })
    el.addEventListener('touchmove', touch, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('touchstart', touch)
      el.removeEventListener('touchmove', touch)
    }
  }, [])

  return <div ref={ref} className={`resize-handle ${className}`} role="separator" aria-label={label} title={label} />
}
