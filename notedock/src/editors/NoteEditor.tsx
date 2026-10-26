import { useCallback, useEffect, useRef, useState } from 'react'
import { GROW_STEP, INK_LOGICAL_WIDTH, type InkBackground, type NoteDoc } from '../formats/notedock'
import type { InkEngine } from '../ink/InkEngine'
import InkToolbar, { type ToolState } from '../ink/InkToolbar'
import type { Stroke } from '../ink/model'
import { cleanupNote, loadInk, loadNote, saveInk, saveNote } from '../services/notes'
import { touchProject } from '../services/projects'
import { logError, useAppStore } from '../state/appStore'
import { activeEditor } from './activeEditor'
import InkBlockView from './InkBlockView'

const SAVE_DELAY_MS = 1000

function applyTools(e: InkEngine, t: ToolState) {
  e.setTool(t.tool)
  e.color = t.penColor
  e.markerColor = t.markerColor
  e.penLevel = t.penLevel
  e.markerLevel = t.markerLevel
  e.eraserLevel = t.eraserLevel
}

/** .notedock のエディタ。段階2では手書きブロックを扱う（テキスト・画像ブロックは段階4） */
export default function NoteEditor({ projectId, path }: { projectId: string; path: string }) {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const readOnly = useAppStore((s) => s.readOnly)
  const setSaveState = useAppStore((s) => s.setSaveState)
  const [note, setNote] = useState<NoteDoc | null>(null)
  const [inks, setInks] = useState<Record<string, Stroke[]> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const [history, setHistory] = useState<Record<string, { canUndo: boolean; canRedo: boolean }>>({})
  const [tools, setTools] = useState<ToolState>(() => ({
    tool: 'pen',
    penColor: settings.tools.pen.color,
    markerColor: settings.tools.marker.color,
    penLevel: settings.tools.pen.sizeLevel,
    markerLevel: settings.tools.marker.sizeLevel,
    eraserLevel: settings.eraserLevel,
    finger: settings.fingerDrawDefault,
  }))
  const engines = useRef(new Map<string, InkEngine>())
  const settingsTimer = useRef<number | undefined>(undefined)
  const toolsRef = useRef(tools)
  useEffect(() => {
    toolsRef.current = tools
  }, [tools])
  const activeBlock = useRef<string | null>(null)
  const pendingInk = useRef(new Map<string, Stroke[]>())
  const noteDirty = useRef(false)
  const latestNote = useRef<NoteDoc | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const saveRef = useRef<() => Promise<void>>(async () => {})
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)

  // 読み込み
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const n = await loadNote(projectId, path)
        const loaded: Record<string, Stroke[]> = {}
        for (const b of n.blocks) if (b.type === 'ink') loaded[b.id] = await loadInk(projectId, path, b.id)
        if (cancelled) return
        latestNote.current = n
        setNote(n)
        setInks(loaded)
        void cleanupNote(projectId, path, n)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, path])

  const save = useCallback(async () => {
    window.clearTimeout(timer.current)
    const inkItems = [...pendingInk.current]
    const writeNote = noteDirty.current && latestNote.current
    if (!inkItems.length && !writeNote) return
    pendingInk.current.clear()
    noteDirty.current = false
    setSaveState('saving')
    try {
      for (const [blockId, strokes] of inkItems) await saveInk(projectId, path, blockId, strokes)
      if (writeNote) await saveNote(projectId, path, latestNote.current!)
      setSaveState(pendingInk.current.size || noteDirty.current ? 'saving' : 'saved')
      void touchProject(projectId)
    } catch (err) {
      // 保存できなかった分は戻して、少し待って再試行する
      for (const [id, s] of inkItems) if (!pendingInk.current.has(id)) pendingInk.current.set(id, s)
      if (writeNote) noteDirty.current = true
      setSaveState('error')
      logError(err)
      useAppStore.getState().toast(`保存できませんでした: ${err instanceof Error ? err.message : err}`, 'error')
      timer.current = window.setTimeout(() => void saveRef.current(), 5000)
    }
  }, [projectId, path, setSaveState])
  useEffect(() => {
    saveRef.current = save
  }, [save])

  const scheduleSave = useCallback(() => {
    setSaveState('saving')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void saveRef.current(), SAVE_DELAY_MS)
  }, [setSaveState])

  // ファイルを閉じるとき・アプリが背面に回るときは、すぐに保存する
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && void save()
    activeEditor.flush = save
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', save)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', save)
      if (activeEditor.flush === save) activeEditor.flush = async () => {}
      void save()
    }
  }, [save])

  // 表示幅に合わせる
  useEffect(() => {
    if (!scroller) return
    const update = () => setWidth(scroller.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(scroller)
    return () => ro.disconnect()
  }, [scroller])

  const updateNote = useCallback((fn: (n: NoteDoc) => NoteDoc) => {
    setNote((prev) => {
      if (!prev) return prev
      const next = fn(prev)
      latestNote.current = next
      noteDirty.current = true
      return next
    })
    scheduleSave()
  }, [scheduleSave])

  // 画面より短い手書きブロックは、画面の高さまで伸ばす
  useEffect(() => {
    if (!note || !width || !scroller) return
    const minHeight = Math.ceil((scroller.clientHeight / width) * INK_LOGICAL_WIDTH)
    const inkBlocks = note.blocks.filter((b) => b.type === 'ink')
    if (inkBlocks.length === 1 && note.blocks.length === 1 && inkBlocks[0].height < minHeight) {
      updateNote((n) => ({ ...n, blocks: n.blocks.map((b) => (b.type === 'ink' ? { ...b, height: minHeight } : b)) }))
    }
  }, [note, width, scroller, updateNote])

  const onChange = useCallback((blockId: string, strokes: Stroke[]) => {
    activeBlock.current = blockId
    setActiveBlockId(blockId)
    pendingInk.current.set(blockId, strokes)
    scheduleSave()
  }, [scheduleSave])

  const onGrow = useCallback((blockId: string, y: number) => {
    updateNote((n) => ({
      ...n,
      blocks: n.blocks.map((b) => (b.id === blockId && b.type === 'ink' && y > b.height - 100 ? { ...b, height: b.height + GROW_STEP } : b)),
    }))
  }, [updateNote])

  const onHistory = useCallback((blockId: string, canUndo: boolean, canRedo: boolean) => {
    if (canUndo || canRedo) {
      activeBlock.current = blockId
      setActiveBlockId(blockId)
    }
    setHistory((h) => ({ ...h, [blockId]: { canUndo, canRedo } }))
  }, [])

  const onEngine = useCallback((blockId: string, engine: InkEngine | null) => {
    if (engine) {
      engines.current.set(blockId, engine)
      applyTools(engine, toolsRef.current)
    }
    else engines.current.delete(blockId)
  }, [])

  const activeEngine = () => {
    const id = activeBlock.current ?? [...engines.current.keys()][0]
    return id ? engines.current.get(id) : undefined
  }
  const activeHistory = history[activeBlockId ?? Object.keys(history)[0] ?? ''] ?? { canUndo: false, canRedo: false }

  const changeTools = (patch: Partial<ToolState>) => {
    const next = { ...tools, ...patch }
    // React の再描画を待たずに、手書き面へすぐ反映する
    for (const e of engines.current.values()) applyTools(e, next)
    setTools(next)
    // 色と太さはツールごとに記憶する（指で描くは開いたファイルごと）。保存は少しまとめてから行う
    if ('penColor' in patch || 'markerColor' in patch || 'penLevel' in patch || 'markerLevel' in patch || 'eraserLevel' in patch) {
      window.clearTimeout(settingsTimer.current)
      settingsTimer.current = window.setTimeout(() => {
        void updateSettings({
          tools: { pen: { color: next.penColor, sizeLevel: next.penLevel }, marker: { color: next.markerColor, sizeLevel: next.markerLevel } },
          eraserLevel: next.eraserLevel,
        })
      }, 800)
    }
  }

  const setBackground = (bg: InkBackground) => {
    const id = activeBlockId ?? note?.blocks.find((b) => b.type === 'ink')?.id
    updateNote((n) => ({ ...n, blocks: n.blocks.map((b) => (b.type === 'ink' && (b.id === id || n.blocks.length === 1) ? { ...b, background: bg } : b)) }))
  }

  // キーボード（Windows で確認するとき）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable]')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) activeEngine()?.redo()
        else activeEngine()?.undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        activeEngine()?.redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        activeEngine()?.deleteSelection()
      } else if (e.key === 'Escape') {
        activeEngine()?.clearSelection()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (error) return <div className="editor-message">ノートを開けませんでした: {error}</div>
  if (!note || !inks) return <div className="editor-message">読み込み中…</div>

  const firstInk = note.blocks.find((b) => b.type === 'ink')
  return (
    <div className="note-editor">
      <InkToolbar
        state={tools}
        onChange={changeTools}
        canUndo={activeHistory.canUndo}
        canRedo={activeHistory.canRedo}
        onUndo={() => activeEngine()?.undo()}
        onRedo={() => activeEngine()?.redo()}
        background={firstInk?.type === 'ink' ? firstInk.background : undefined}
        onBackground={firstInk ? setBackground : undefined}
      />
      <div ref={setScroller} className="note-scroll">
        {width > 0 && note.blocks.map((b) =>
          b.type === 'ink' ? (
            <InkBlockView
              key={b.id}
              block={b}
              strokes={inks[b.id] ?? []}
              width={width}
              tool={tools.tool}
              penColor={tools.penColor}
              finger={tools.finger}
              holdMs={settings.lineSnapHoldMs}
              readOnly={readOnly}
              scroller={scroller}
              onEngine={onEngine}
              onChange={onChange}
              onHistory={onHistory}
              onGrow={onGrow}
            />
          ) : (
            <div key={b.id} className="block-placeholder">テキスト・画像のブロックは、今後のバージョンで対応します</div>
          ),
        )}
      </div>
    </div>
  )
}
