import { Copy, Palette, Trash2 } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import type { AssetResolver } from '../ink/assets'
import { InkEngine, type Selection } from '../ink/InkEngine'
import type { InkItem } from '../ink/items'
import { ItemsLayer, ItemsOverlay } from '../ink/ItemsLayer'
import type { SizeLevel, Stroke, Tool } from '../ink/model'
import { useInkItems } from '../ink/useInkItems'

type Props = {
  pageKey: string
  /** 表示上の大きさ（px） */
  width: number
  height: number
  /** 座標系の横幅（PDF は pt、画像はピクセル）。表示の倍率 = width / logicalWidth */
  logicalWidth: number
  /** 手書きの層を作るときに、そのページの線を読む */
  getStrokes: () => Stroke[]
  /** 手書きの層を作るときに、そのページに置いたものを読む */
  getItems: () => InkItem[]
  /** 置く画像の保存場所 */
  assets: AssetResolver
  textStyle: () => { level: SizeLevel; color: string }
  tool: Tool
  penColor: string
  finger: boolean
  holdMs: number
  readOnly: boolean
  scroller: HTMLElement | null
  onEngine: (key: string, engine: InkEngine | null) => void
  onChange: (key: string, strokes: Stroke[], items: InkItem[]) => void
  onHistory: (key: string, canUndo: boolean, canRedo: boolean) => void
  /** true のとき、描かない指の操作で scroller を縦にスクロールする（ノートの中の画像） */
  touchPan?: boolean
}

/** PDF のページや画像の上に重ねる手書きの層。指のスクロール・ピンチは表示側（ZoomViewport）が行う */
function PageInk({ pageKey, width, height, logicalWidth, getStrokes, getItems, assets, textStyle, tool, penColor, finger, holdMs, readOnly, scroller, onEngine, onChange, onHistory, touchPan = false }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<InkEngine | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const itemsUi = useInkItems(engineRef)
  const scale = width / logicalWidth
  const live = useRef({ scale, holdMs, finger, readOnly, scroller, onChange, onHistory, textStyle, logicalWidth })
  useEffect(() => {
    live.current = { scale, holdMs, finger, readOnly, scroller, onChange, onHistory, textStyle, logicalWidth }
  })

  useEffect(() => {
    const engine = new InkEngine(hostRef.current!, {
      scale: () => live.current.scale,
      scroller: () => live.current.scroller,
      holdMs: () => live.current.holdMs,
      fingerDraw: () => live.current.finger,
      readOnly: () => live.current.readOnly,
      onChange: (s, items) => live.current.onChange(pageKey, s, items),
      onSelection: setSelection,
      onHistory: (u, r) => live.current.onHistory(pageKey, u, r),
      touchPan,
      ...itemsUi.engineOptions,
      logicalWidth: () => live.current.logicalWidth,
      textStyle: () => live.current.textStyle(),
      assets,
    })
    engine.setStrokes(getStrokes(), getItems())
    engineRef.current = engine
    onEngine(pageKey, engine)
    return () => {
      onEngine(pageKey, null)
      engine.destroy()
      engineRef.current = null
    }
    // 線はエンジンが持つ。作るときだけ渡す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey])

  useEffect(() => {
    engineRef.current?.refresh()
  }, [width, height, scroller])

  const sel = selection?.bounds
  return (
    <>
      <ItemsLayer ref={itemsUi.layerRef} items={itemsUi.items} selectedId={itemsUi.selectedId} editingId={itemsUi.editingId} scale={scale} assets={assets} />
      <div ref={hostRef} className="page-ink" aria-label="手書き" />
      <ItemsOverlay items={itemsUi.items} selectedId={itemsUi.selectedId} editingId={itemsUi.editingId} scale={scale} width={width} engineRef={engineRef} readOnly={readOnly} onEdit={itemsUi.setEditingId} />
      {sel && tool === 'lasso' && (
        <div className="selection-toolbar" style={{ left: Math.max(4, Math.min(width - 200, sel.x * scale)), top: Math.max(4, sel.y * scale - 48) }}>
          <button className="btn small" onClick={() => engineRef.current?.recolorSelection(penColor)} title="今の色にする">
            <Palette size={16} /><span className="swatch" style={{ background: penColor }} />
          </button>
          <button className="btn small" onClick={() => engineRef.current?.duplicateSelection()}><Copy size={16} /> 複製</button>
          <button className="btn small btn-danger" onClick={() => engineRef.current?.deleteSelection()}><Trash2 size={16} /> 削除</button>
        </div>
      )}
    </>
  )
}

export default memo(PageInk)
