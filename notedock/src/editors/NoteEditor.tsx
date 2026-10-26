import { ArrowDown, ArrowUp, Camera, Copy, ImagePlus, MoreVertical, PenLine, Plus, Trash2, Type } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PopupMenu, type MenuState } from '../components/common'
import type { InkSidecar } from '../formats/inkSidecar'
import {
  BLOCK_INK_HEIGHT, GROW_STEP, INK_LOGICAL_WIDTH, newInkBlock, newTextBlock,
  type Block, type ImageBlock, type InkBackground, type NoteDoc,
} from '../formats/notedock'
import InkToolbar from '../ink/InkToolbar'
import { newStrokeId, type Stroke } from '../ink/model'
import { useInkSession } from '../ink/useInkSession'
import { saveSidecar } from '../services/annotations'
import { addNoteImage, cleanupNote, copyNoteFile, loadInkData, loadNote, noteFileExists, saveInk, saveNote } from '../services/notes'
import { assetsDirOf, noteAssets } from '../ink/assets'
import type { InkItem } from '../ink/items'
import { touchProject } from '../services/projects'
import { logError, reportError, useAppStore } from '../state/appStore'
import { dialogs } from '../state/dialogs'
import { activeEditor } from './activeEditor'
import InkBlockView from './InkBlockView'
import ImageBlockView from './note/ImageBlockView'
import TextBlockView from './note/TextBlockView'

const SAVE_DELAY_MS = 1000

type InkContentData = { strokes: Stroke[]; items: InkItem[] }

/**
 * .notedock のエディタ（S04）。テキスト・手書き・画像のブロックを縦に並べる。
 * 手書きブロック1つだけのノート（手書きノート）もこのエディタで開く
 */
export default function NoteEditor({ projectId, path }: { projectId: string; path: string }) {
  const readOnly = useAppStore((s) => s.readOnly)
  const setSaveState = useAppStore((s) => s.setSaveState)
  const session = useInkSession()
  const [note, setNote] = useState<NoteDoc | null>(null)
  /** 手書きブロックの線と置いたもの（読み込み時の内容。以後はエンジンが持つ） */
  const [inks, setInks] = useState<Record<string, InkContentData> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState>(null)
  const pendingInk = useRef(new Map<string, InkContentData>())
  const inkImageInput = useRef<HTMLInputElement>(null)
  const assets = useMemo(() => noteAssets(projectId, path), [projectId, path])
  const pendingImageInk = useRef(new Map<string, { block: ImageBlock; sidecar: InkSidecar }>())
  const noteDirty = useRef(false)
  const latestNote = useRef<NoteDoc | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const saveRef = useRef<() => Promise<void>>(async () => {})
  const imageInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const insertAt = useRef(0)

  // 読み込み
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const n = await loadNote(projectId, path)
        const loaded: Record<string, InkContentData> = {}
        for (const b of n.blocks) if (b.type === 'ink') loaded[b.id] = await loadInkData(projectId, path, b.id)
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

  // ---- 保存 ----

  const save = useCallback(async () => {
    window.clearTimeout(timer.current)
    const inkItems = [...pendingInk.current]
    const imageItems = [...pendingImageInk.current.values()]
    const writeNote = noteDirty.current && latestNote.current
    if (!inkItems.length && !imageItems.length && !writeNote) return
    pendingInk.current.clear()
    pendingImageInk.current.clear()
    noteDirty.current = false
    setSaveState('saving')
    try {
      for (const [blockId, c] of inkItems) await saveInk(projectId, path, blockId, c.strokes, c.items)
      for (const { block, sidecar } of imageItems) await saveSidecar(projectId, `${path}/${block.src}`, sidecar)
      if (writeNote) await saveNote(projectId, path, latestNote.current!)
      setSaveState(pendingInk.current.size || pendingImageInk.current.size || noteDirty.current ? 'saving' : 'saved')
      void touchProject(projectId)
    } catch (err) {
      // 保存できなかった分は戻して、少し待って再試行する
      for (const [id, s] of inkItems) if (!pendingInk.current.has(id)) pendingInk.current.set(id, s)
      for (const item of imageItems) if (!pendingImageInk.current.has(item.block.id)) pendingImageInk.current.set(item.block.id, item)
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
      void save().then(() => latestNote.current && cleanupNote(projectId, path, latestNote.current))
    }
  }, [save, projectId, path])

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

  // 手書きブロックだけのノートは、画面の高さまで伸ばす
  useEffect(() => {
    if (!note || !width || !scroller) return
    if (note.blocks.length !== 1 || note.blocks[0].type !== 'ink') return
    const minHeight = Math.ceil((scroller.clientHeight / width) * INK_LOGICAL_WIDTH)
    if (note.blocks[0].height < minHeight) updateNote((n) => ({ ...n, blocks: n.blocks.map((b) => (b.type === 'ink' ? { ...b, height: minHeight } : b)) }))
  }, [note, width, scroller, updateNote])

  // ---- ブロックの変更 ----

  const onInkChange = useCallback((blockId: string, strokes: Stroke[], items: InkItem[]) => {
    session.markActive(blockId)
    pendingInk.current.set(blockId, { strokes, items })
    scheduleSave()
  }, [session, scheduleSave])

  const onImageInkChange = useCallback((block: ImageBlock, sidecar: InkSidecar) => {
    session.markActive(block.id)
    pendingImageInk.current.set(block.id, { block, sidecar })
    scheduleSave()
  }, [session, scheduleSave])

  const onGrow = useCallback((blockId: string, y: number) => {
    updateNote((n) => ({
      ...n,
      blocks: n.blocks.map((b) => (b.id === blockId && b.type === 'ink' && y > b.height - 100 ? { ...b, height: b.height + GROW_STEP } : b)),
    }))
  }, [updateNote])

  const resizeInk = useCallback((blockId: string, height: number) => {
    updateNote((n) => ({ ...n, blocks: n.blocks.map((b) => (b.id === blockId && b.type === 'ink' ? { ...b, height } : b)) }))
  }, [updateNote])

  const resizeImage = useCallback((blockId: string, displayRatio: number) => {
    updateNote((n) => ({ ...n, blocks: n.blocks.map((b) => (b.id === blockId && b.type === 'image' ? { ...b, displayRatio } : b)) }))
  }, [updateNote])

  const insertBlock = (index: number, block: Block) => {
    if (block.type === 'ink') {
      setInks((m) => ({ ...m, [block.id]: { strokes: [], items: [] } }))
      pendingInk.current.set(block.id, { strokes: [], items: [] })
    }
    updateNote((n) => {
      const blocks = [...n.blocks]
      blocks.splice(index, 0, block)
      return { ...n, blocks }
    })
    if (block.type === 'text') setEditingId(block.id)
  }

  const addInk = (index: number) => insertBlock(index, newInkBlock('grid', BLOCK_INK_HEIGHT))
  const addText = (index: number) => insertBlock(index, newTextBlock())
  const pickImage = (index: number, camera: boolean) => {
    insertAt.current = index
    ;(camera ? cameraInput : imageInput).current?.click()
  }

  const onImages = async (files: FileList | null) => {
    if (!files?.length) return
    let index = insertAt.current
    for (const f of [...files]) {
      try {
        insertBlock(index++, await addNoteImage(projectId, path, f))
      } catch (err) {
        reportError(err, `「${f.name}」を追加できませんでした: `)
      }
    }
  }

  const moveBlock = (id: string, dir: -1 | 1) =>
    updateNote((n) => {
      const i = n.blocks.findIndex((b) => b.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= n.blocks.length) return n
      const blocks = [...n.blocks]
      ;[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
      return { ...n, blocks }
    })

  const duplicateBlock = async (block: Block) => {
    const index = (latestNote.current?.blocks.findIndex((b) => b.id === block.id) ?? 0) + 1
    try {
      if (block.type === 'text') insertBlock(index, { ...block, id: crypto.randomUUID() })
      else if (block.type === 'ink') {
        const engine = session.engines.current.get(block.id)
        const strokes = engine?.getStrokes() ?? inks?.[block.id]?.strokes ?? []
        const items = engine?.getItems() ?? inks?.[block.id]?.items ?? []
        const copy = { ...block, id: crypto.randomUUID() }
        const copied = { strokes: strokes.map((s) => ({ ...s, id: newStrokeId() })), items: items.map((i) => ({ ...i, id: crypto.randomUUID() })) }
        setInks((m) => ({ ...m, [copy.id]: copied }))
        updateNote((n) => {
          const blocks = [...n.blocks]
          blocks.splice(index, 0, copy)
          return { ...n, blocks }
        })
        pendingInk.current.set(copy.id, copied)
      } else {
        await save()
        const id = crypto.randomUUID()
        const src = block.src.replace(/[^/]+(\.[^.]+)$/, `${id}$1`)
        await copyNoteFile(projectId, path, block.src, src)
        if (await noteFileExists(projectId, path, `${block.src}.ink.json`)) await copyNoteFile(projectId, path, `${block.src}.ink.json`, `${src}.ink.json`)
        if (await noteFileExists(projectId, path, assetsDirOf(block.src))) await copyNoteFile(projectId, path, assetsDirOf(block.src), assetsDirOf(src))
        insertBlock(index, { ...block, id, src })
      }
    } catch (err) {
      reportError(err, '複製できませんでした: ')
    }
  }

  const deleteBlock = async (block: Block) => {
    const engine = session.engines.current.get(block.id)
    const empty = block.type === 'text'
      ? !block.markdown.trim()
      : block.type === 'ink'
        ? !(engine?.getStrokes() ?? inks?.[block.id]?.strokes ?? []).length && !(engine?.getItems() ?? inks?.[block.id]?.items ?? []).length
        : false
    if (!empty) {
      const ok = await dialogs.confirm({ title: 'ブロックを削除します', message: block.type === 'image' ? '画像と、その上の書き込みが削除されます。' : '元に戻せません。', okLabel: '削除', danger: true })
      if (!ok) return
    }
    pendingInk.current.delete(block.id)
    pendingImageInk.current.delete(block.id)
    updateNote((n) => ({ ...n, blocks: n.blocks.filter((b) => b.id !== block.id) }))
  }

  const blockMenu = (block: Block, index: number, total: number, anchor: { x: number; y: number }) =>
    setMenu({
      anchor,
      items: [
        ...(index > 0 ? [{ label: '上へ', icon: <ArrowUp size={16} />, onSelect: () => moveBlock(block.id, -1) }] : []),
        ...(index < total - 1 ? [{ label: '下へ', icon: <ArrowDown size={16} />, onSelect: () => moveBlock(block.id, 1) }] : []),
        { label: '複製', icon: <Copy size={16} />, onSelect: () => void duplicateBlock(block) },
        'separator' as const,
        { label: '削除', icon: <Trash2 size={16} />, danger: true, onSelect: () => void deleteBlock(block) },
      ],
    })

  const insertMenu = (index: number, anchor: { x: number; y: number }) =>
    setMenu({
      anchor,
      items: [
        { label: '文章', icon: <Type size={16} />, onSelect: () => addText(index) },
        { label: '手書き', icon: <PenLine size={16} />, onSelect: () => addInk(index) },
        { label: '画像', icon: <ImagePlus size={16} />, onSelect: () => pickImage(index, false) },
        { label: 'カメラで撮る', icon: <Camera size={16} />, onSelect: () => pickImage(index, true) },
      ],
    })

  const setBackground = (bg: InkBackground) => {
    const blocks = latestNote.current?.blocks ?? []
    const target = blocks.find((b) => b.id === session.activeId && b.type === 'ink') ?? blocks.find((b) => b.type === 'ink')
    if (target) updateNote((n) => ({ ...n, blocks: n.blocks.map((b) => (b.id === target.id && b.type === 'ink' ? { ...b, background: bg } : b)) }))
  }

  const onEndEdit = (id: string) => {
    setEditingId((cur) => (cur === id ? null : cur))
    // 空の文章ブロックは、ほかのブロックがあれば消す
    updateNote((n) => {
      const b = n.blocks.find((x) => x.id === id)
      if (b?.type === 'text' && !b.markdown.trim() && n.blocks.length > 1) return { ...n, blocks: n.blocks.filter((x) => x.id !== id) }
      return n
    })
  }

  if (error) return <div className="editor-message">ノートを開けませんでした: {error}</div>
  if (!note || !inks) return <div className="editor-message">読み込み中…</div>

  const activeInk = note.blocks.find((b) => b.id === session.activeId && b.type === 'ink') ?? note.blocks.find((b) => b.type === 'ink')
  const handwritingOnly = note.blocks.length === 1 && note.blocks[0].type === 'ink'

  /** ブロックの間。ペンで触れると手書きブロックを作り、指やマウスで触れると追加のメニューを開く */
  const gap = (index: number) =>
    !handwritingOnly && !readOnly && (
      <div
        key={`gap-${index}`}
        className="block-gap"
        onPointerDown={(e) => {
          if (e.pointerType === 'pen') {
            e.preventDefault()
            addInk(index)
          }
        }}
        onClick={(e) => insertMenu(index, { x: e.clientX, y: e.clientY })}
        title="ここに追加"
      >
        <span className="block-gap-line" />
        <Plus size={14} className="block-gap-plus" />
      </div>
    )

  return (
    <div className="note-editor">
      <InkToolbar
        state={session.tools}
        onChange={session.changeTools}
        canUndo={session.activeHistory.canUndo}
        canRedo={session.activeHistory.canRedo}
        onUndo={session.undo}
        onRedo={session.redo}
        background={activeInk?.type === 'ink' ? activeInk.background : undefined}
        onBackground={activeInk ? setBackground : undefined}
        onInsertImage={() => inkImageInput.current?.click()}
      />
      <div ref={setScroller} className={`note-scroll ${handwritingOnly ? '' : 'mixed'}`}>
        {width > 0 && (
          <>
            {note.blocks.map((b, i) => (
              <div key={b.id} className={`note-block note-block-${b.type}`}>
                {gap(i)}
                <div className="note-block-body">
                  {b.type === 'ink' && (
                    <InkBlockView
                      block={b}
                      strokes={inks[b.id]?.strokes ?? []}
                      items={inks[b.id]?.items ?? []}
                      assets={assets}
                      textStyle={session.textStyle}
                      width={width}
                      tool={session.tools.tool}
                      penColor={session.tools.penColor}
                      finger={session.tools.finger}
                      holdMs={session.holdMs}
                      readOnly={readOnly}
                      scroller={scroller}
                      onEngine={session.onEngine}
                      onChange={onInkChange}
                      onHistory={session.onHistory}
                      onGrow={onGrow}
                      onResize={handwritingOnly ? undefined : resizeInk}
                    />
                  )}
                  {b.type === 'text' && (
                    <TextBlockView
                      projectId={projectId}
                      notePath={path}
                      block={b}
                      editing={editingId === b.id}
                      readOnly={readOnly}
                      onStartEdit={setEditingId}
                      onChange={(id, markdown) => updateNote((n) => ({ ...n, blocks: n.blocks.map((x) => (x.id === id && x.type === 'text' ? { ...x, markdown } : x)) }))}
                      onEndEdit={onEndEdit}
                    />
                  )}
                  {b.type === 'image' && (
                    <ImageBlockView
                      projectId={projectId}
                      notePath={path}
                      block={b}
                      width={width}
                      tool={session.tools.tool}
                      penColor={session.tools.penColor}
                      finger={session.tools.finger}
                      holdMs={session.holdMs}
                      readOnly={readOnly}
                      scroller={scroller}
                      onEngine={session.onEngine}
                      onHistory={session.onHistory}
                      onInkChange={onImageInkChange}
                      textStyle={session.textStyle}
                      onResize={resizeImage}
                    />
                  )}
                  {!handwritingOnly && !readOnly && (
                    <button
                      className="icon-btn small block-menu-btn"
                      aria-label="ブロックのメニュー"
                      onClick={(e) => {
                        const r = e.currentTarget.getBoundingClientRect()
                        blockMenu(b, i, note.blocks.length, { x: r.left - 160, y: r.bottom + 4 })
                      }}
                    >
                      <MoreVertical size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!handwritingOnly && !readOnly && (
              <div
                className="note-end"
                onPointerDown={(e) => {
                  // ノートの下の余白をペンでなぞると、手書きブロックを追加する
                  if (e.pointerType === 'pen' && e.target === e.currentTarget) {
                    e.preventDefault()
                    addInk(note.blocks.length)
                  }
                }}
              >
                <div className="note-add-bar">
                  <button className="btn small" onClick={() => addText(note.blocks.length)}><Type size={16} /> 文章</button>
                  <button className="btn small" onClick={() => addInk(note.blocks.length)}><PenLine size={16} /> 手書き</button>
                  <button className="btn small" onClick={() => pickImage(note.blocks.length, false)}><ImagePlus size={16} /> 画像</button>
                  <button className="btn small" onClick={() => pickImage(note.blocks.length, true)}><Camera size={16} /> カメラ</button>
                </div>
                <p className="muted small note-end-hint">ブロックの間や、この下の余白をPencilでなぞると手書きを追加できます</p>
              </div>
            )}
          </>
        )}
      </div>
      <input ref={inkImageInput} type="file" accept="image/*,.heic,.heif" hidden onChange={(e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (f) session.insertImage(f).catch((err) => reportError(err, '画像を置けませんでした: '))
      }} />
      <input ref={imageInput} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => { void onImages(e.target.files); e.target.value = '' }} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onImages(e.target.files); e.target.value = '' }} />
      {menu && <PopupMenu anchor={menu.anchor} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}
