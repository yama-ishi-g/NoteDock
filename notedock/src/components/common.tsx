import { AlertTriangle, Check, CloudOff, Loader2, X } from 'lucide-react'
import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { logError, useAppStore } from '../state/appStore'

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismissToast)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === 'error' && <AlertTriangle size={16} />}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}

export function SaveIndicator() {
  const state = useAppStore((s) => s.saveState)
  if (state === 'idle') return null
  return (
    <span className={`save-indicator ${state}`}>
      {state === 'saving' && <><Loader2 size={14} className="spin" /> 保存中…</>}
      {state === 'saved' && <><Check size={14} /> 保存済み</>}
      {state === 'error' && <><CloudOff size={14} /> 保存失敗</>}
    </span>
  )
}

type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void } | 'separator'

/** 長押し・右クリック・「…」ボタンで開くメニュー */
export function PopupMenu({ anchor, items, onClose }: { anchor: { x: number; y: number }; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState(anchor)
  useEffect(() => {
    // 画面からはみ出さない位置に調整する
    const el = ref.current!
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.max(8, Math.min(anchor.x, window.innerWidth - r.width - 8)),
      y: Math.max(8, Math.min(anchor.y, window.innerHeight - r.height - 8)),
    })
  }, [anchor])
  return (
    <div className="menu-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()} onContextMenu={(e) => { e.preventDefault(); onClose() }}>
      <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} role="menu">
        {items.map((item, i) =>
          item === 'separator' ? (
            <div key={i} className="menu-separator" />
          ) : (
            <button key={i} role="menuitem" className={`menu-item ${item.danger ? 'danger' : ''}`} onClick={() => { onClose(); item.onSelect() }}>
              {item.icon}
              <span>{item.label}</span>
            </button>
          ),
        )}
      </div>
    </div>
  )
}

export type MenuState = { anchor: { x: number; y: number }; items: MenuItem[] } | null

export function Banner({ kind = 'info', children, onClose }: { kind?: 'info' | 'warning'; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`banner ${kind}`}>
      <div className="banner-body">{children}</div>
      {onClose && <button className="icon-btn small" onClick={onClose} aria-label="閉じる"><X size={16} /></button>}
    </div>
  )
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    logError(error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="fatal">
        <h1>問題が発生しました</h1>
        <p>{this.state.error.message}</p>
        <button className="btn btn-primary" onClick={() => location.reload()}>再読み込み</button>
      </div>
    )
  }
}
