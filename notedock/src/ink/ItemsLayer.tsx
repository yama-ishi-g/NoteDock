import { Copy, Pencil, Trash2 } from 'lucide-react'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { AssetResolver } from './assets'
import type { InkEngine, ItemHit } from './InkEngine'
import { TEXT_LINE_HEIGHT, type InkItem } from './items'

// 手書きの欄に置いた画像・テキストボックスの表示
//   ItemsLayer: 手書きの線の下に表示する（画像や文字の上から書き込めるように）
//   ItemsOverlay: 編集中の入力欄と、選んだものの操作ボタン（手書き面の上に出す）

export type ItemsLayerHandle = { hitTest: (clientX: number, clientY: number) => ItemHit | null }

const HANDLE_PX = 22

function useAssetUrls(items: InkItem[], assets: AssetResolver | undefined) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const loaded = useRef(new Map<string, string>())
  useEffect(() => {
    if (!assets) return
    for (const i of items) {
      if (i.type !== 'image' || loaded.current.has(i.src)) continue
      loaded.current.set(i.src, '')
      assets.url(i.src).then(
        (u) => {
          loaded.current.set(i.src, u)
          setUrls((m) => ({ ...m, [i.src]: u }))
        },
        () => loaded.current.delete(i.src),
      )
    }
  }, [items, assets])
  useEffect(() => {
    const map = loaded.current
    return () => map.forEach((u) => u && URL.revokeObjectURL(u))
  }, [])
  return urls
}

type LayerProps = {
  items: InkItem[]
  selectedId: string | null
  editingId: string | null
  scale: number
  assets: AssetResolver | undefined
}

export const ItemsLayer = forwardRef<ItemsLayerHandle, LayerProps>(function ItemsLayer({ items, selectedId, editingId, scale, assets }, ref) {
  const urls = useAssetUrls(items, assets)
  const els = useRef(new Map<string, HTMLDivElement>())

  useImperativeHandle(ref, () => ({
    hitTest: (x, y) => {
      // 上に重なっているもの（後に置いたもの）から調べる
      for (const item of [...items].reverse()) {
        const el = els.current.get(item.id)
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (item.id === selectedId && Math.abs(x - r.right) <= HANDLE_PX && Math.abs(y - r.bottom) <= HANDLE_PX) return { id: item.id, handle: true }
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { id: item.id, handle: false }
      }
      return null
    },
  }), [items, selectedId])

  return (
    <div className="ink-items">
      {items.map((item) => {
        const style = { left: item.x * scale, top: item.y * scale, width: item.w * scale }
        const selected = item.id === selectedId
        return (
          <div
            key={item.id}
            ref={(el) => {
              if (el) els.current.set(item.id, el)
              else els.current.delete(item.id)
            }}
            className={`ink-item ink-item-${item.type} ${selected ? 'selected' : ''}`}
            style={item.type === 'image' ? { ...style, height: item.h * scale } : { ...style, fontSize: item.fontSize * scale, color: item.color, lineHeight: TEXT_LINE_HEIGHT }}
          >
            {item.type === 'image' ? (urls[item.src] ? <img src={urls[item.src]} alt="" draggable={false} /> : null) : (
              // 編集中は入力欄（ItemsOverlay）だけを見せる
              <span style={{ visibility: editingId === item.id ? 'hidden' : 'visible' }}>{item.text || ' '}</span>
            )}
            {selected && <span className="ink-item-handle" />}
          </div>
        )
      })}
    </div>
  )
})

type OverlayProps = {
  items: InkItem[]
  selectedId: string | null
  editingId: string | null
  scale: number
  width: number
  engineRef: React.RefObject<InkEngine | null>
  readOnly: boolean
  onEdit: (id: string | null) => void
}

export function ItemsOverlay({ items, selectedId, editingId, scale, width, engineRef, readOnly, onEdit }: OverlayProps) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const editing = items.find((i) => i.id === editingId)
  const selected = items.find((i) => i.id === selectedId)

  // 入力欄の高さを文字に合わせる
  useLayoutEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  })

  useEffect(() => {
    if (!editingId) return
    const ta = taRef.current
    ta?.focus({ preventScroll: true })
    if (ta) ta.setSelectionRange(ta.value.length, ta.value.length)
  }, [editingId])

  // 編集中のテキストボックスは、指2本で動かせる（指1本は文字の選択・カーソル移動に使う）
  const live = useRef({ editing, scale, engineRef })
  useEffect(() => {
    live.current = { editing, scale, engineRef }
  })
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    const held = new Set<number>()
    const engine = engineRef
    let drag: { mx: number; my: number; x: number; y: number } | null = null
    const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 })
    const onStart = (e: TouchEvent) => {
      const item = live.current.editing
      // 指の1本が入力欄に触れていれば、2本目はどこに触れてもよい
      if (e.touches.length < 2 || !item || ![...e.touches].some((t) => t.target === ta)) return
      e.preventDefault()
      const m = mid(e.touches)
      drag = { mx: m.x, my: m.y, x: item.x, y: item.y }
    }
    const onMove = (e: TouchEvent) => {
      const item = live.current.editing
      if (!drag || e.touches.length < 2 || !item) return
      e.preventDefault()
      const m = mid(e.touches)
      const s = live.current.scale
      live.current.engineRef.current?.setItemPosition(item.id, drag.x + (m.x - drag.mx) / s, drag.y + (m.y - drag.my) / s)
    }
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) drag = null
    }
    // PDF・画像の表示側（ZoomViewport）に、入力欄の上の指でスクロール・ピンチをさせない
    const stop = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      e.stopPropagation()
      held.add(e.pointerId)
      live.current.engineRef.current?.noteTouch(e.pointerId, true)
    }
    const release = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      held.delete(e.pointerId)
      live.current.engineRef.current?.noteTouch(e.pointerId, false)
    }
    window.addEventListener('touchstart', onStart, { passive: false, capture: true })
    window.addEventListener('touchmove', onMove, { passive: false, capture: true })
    window.addEventListener('touchend', onEnd, true)
    window.addEventListener('touchcancel', onEnd, true)
    ta.addEventListener('pointerdown', stop)
    ta.addEventListener('pointerup', release)
    ta.addEventListener('pointercancel', release)
    return () => {
      // 指を離す前に入力欄が消えたときも、触れている指の記録を残さない
      for (const id of held) engine.current?.noteTouch(id, false)
      ta.removeEventListener('pointerup', release)
      ta.removeEventListener('pointercancel', release)
      window.removeEventListener('touchstart', onStart, true)
      window.removeEventListener('touchmove', onMove, true)
      window.removeEventListener('touchend', onEnd, true)
      window.removeEventListener('touchcancel', onEnd, true)
      ta.removeEventListener('pointerdown', stop)
    }
  }, [editingId, engineRef])

  const finish = () => {
    if (!editingId) return
    engineRef.current?.endTextEdit(editingId)
    onEdit(null)
  }

  return (
    <>
      {editing?.type === 'text' && (
        <textarea
          ref={taRef}
          className="ink-text-input"
          style={{ left: editing.x * scale, top: editing.y * scale, width: editing.w * scale, fontSize: editing.fontSize * scale, color: editing.color, lineHeight: TEXT_LINE_HEIGHT }}
          value={editing.text}
          placeholder="文字を入力"
          onChange={(e) => engineRef.current?.setItemText(editing.id, e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === 'Escape') taRef.current?.blur()
          }}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      )}
      {selected && !editing && !readOnly && (
        <div
          className="selection-toolbar"
          style={{ left: Math.max(4, Math.min(width - 220, selected.x * scale)), top: Math.max(4, selected.y * scale - 48) }}
        >
          {selected.type === 'text' && (
            <button className="btn small" onClick={() => {
              engineRef.current?.beginTextEdit(selected.id)
              onEdit(selected.id)
            }}><Pencil size={16} /> 編集</button>
          )}
          <button className="btn small" onClick={() => engineRef.current?.duplicateSelectedItem()}><Copy size={16} /> 複製</button>
          <button className="btn small btn-danger" onClick={() => engineRef.current?.deleteSelectedItem()}><Trash2 size={16} /> 削除</button>
        </div>
      )}
    </>
  )
}
