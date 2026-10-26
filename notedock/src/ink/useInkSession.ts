import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/appStore'
import type { InkEngine } from './InkEngine'
import type { ToolState } from './InkToolbar'

// 複数の手書き面（PDFのページなど）を1つのツールバーで操作するための共通処理

export function applyTools(e: InkEngine, t: ToolState) {
  e.setTool(t.tool)
  e.color = t.penColor
  e.markerColor = t.markerColor
  e.penLevel = t.penLevel
  e.markerLevel = t.markerLevel
  e.eraserLevel = t.eraserLevel
}

export function useInkSession() {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const [tools, setTools] = useState<ToolState>(() => ({
    tool: 'pen',
    penColor: settings.tools.pen.color,
    markerColor: settings.tools.marker.color,
    penLevel: settings.tools.pen.sizeLevel,
    markerLevel: settings.tools.marker.sizeLevel,
    eraserLevel: settings.eraserLevel,
    textLevel: settings.textLevel,
    textColor: settings.textColor,
    finger: settings.fingerDrawDefault,
  }))
  const engines = useRef(new Map<string, InkEngine>())
  const activeKey = useRef<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [history, setHistory] = useState<Record<string, { canUndo: boolean; canRedo: boolean }>>({})
  const toolsRef = useRef(tools)
  const settingsTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    toolsRef.current = tools
  }, [tools])

  const changeTools = useCallback((patch: Partial<ToolState>) => {
    const next = { ...toolsRef.current, ...patch }
    toolsRef.current = next
    // React の再描画を待たずに、手書き面へすぐ反映する
    for (const e of engines.current.values()) applyTools(e, next)
    setTools(next)
    // 文字の大きさ・色は、選んでいるテキストボックスにも反映する
    if ('textLevel' in patch || 'textColor' in patch) {
      for (const e of engines.current.values()) e.styleSelectedText({ level: patch.textLevel, color: patch.textColor })
    }
    if ('penColor' in patch || 'markerColor' in patch || 'penLevel' in patch || 'markerLevel' in patch || 'eraserLevel' in patch || 'textLevel' in patch || 'textColor' in patch) {
      window.clearTimeout(settingsTimer.current)
      settingsTimer.current = window.setTimeout(() => {
        void updateSettings({
          tools: { pen: { color: next.penColor, sizeLevel: next.penLevel }, marker: { color: next.markerColor, sizeLevel: next.markerLevel } },
          eraserLevel: next.eraserLevel,
          textLevel: next.textLevel,
          textColor: next.textColor,
        })
      }, 800)
    }
  }, [updateSettings])

  const markActive = useCallback((key: string) => {
    activeKey.current = key
    setActiveId(key)
  }, [])

  const onEngine = useCallback((key: string, engine: InkEngine | null) => {
    if (engine) {
      engines.current.set(key, engine)
      applyTools(engine, toolsRef.current)
    } else {
      engines.current.delete(key)
    }
  }, [])

  const onHistory = useCallback((key: string, canUndo: boolean, canRedo: boolean) => {
    if (canUndo || canRedo) markActive(key)
    setHistory((h) => ({ ...h, [key]: { canUndo, canRedo } }))
  }, [markActive])

  const activeEngine = useCallback(() => {
    const key = activeKey.current ?? [...engines.current.keys()][0]
    return key ? engines.current.get(key) : undefined
  }, [])

  const undo = useCallback(() => activeEngine()?.undo(), [activeEngine])
  const redo = useCallback(() => activeEngine()?.redo(), [activeEngine])

  /** 指で描いている途中の線をすべて取り消す（ピンチを始めたとき） */
  const cancelTouch = useCallback(() => {
    for (const e of engines.current.values()) e.cancelTouchGesture()
  }, [])

  const penActive = useCallback(() => [...engines.current.values()].some((e) => e.penActive), [])

  /** 新しいテキストボックスの文字の大きさと色 */
  const textStyle = useCallback(() => ({ level: toolsRef.current.textLevel, color: toolsRef.current.textColor }), [])

  /**
   * 画像を置く。最後に使った手書き面が見えていればそこに、なければ一番大きく見えている手書き面に置く。
   * 置いたら選択ツールにして、すぐに動かせるようにする
   */
  const insertImage = useCallback(async (file: File) => {
    const list = [...engines.current.entries()]
    const active = activeKey.current ? engines.current.get(activeKey.current) : undefined
    const target = active && active.visibleArea > 0 ? [activeKey.current!, active] as const : list.sort((a, b) => b[1].visibleArea - a[1].visibleArea)[0]
    if (!target) return
    const [key, engine] = target
    if (!engine.assets) return
    const stored = await engine.assets.store(file)
    changeTools({ tool: 'select' })
    engine.addImage(stored.src, stored.width, stored.height)
    markActive(key)
  }, [changeTools, markActive])

  // キーボード（Windows で確認するとき）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        activeEngine()?.deleteSelection()
        activeEngine()?.deleteSelectedItem()
      } else if (e.key === 'Escape') {
        activeEngine()?.clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, activeEngine])

  const activeHistory = history[activeId ?? Object.keys(history)[0] ?? ''] ?? { canUndo: false, canRedo: false }

  return { tools, changeTools, onEngine, onHistory, markActive, activeId, engines, undo, redo, cancelTouch, penActive, activeHistory, textStyle, insertImage, holdMs: settings.lineSnapHoldMs }
}
