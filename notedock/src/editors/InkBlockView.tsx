import { Copy, Palette, Trash2 } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'
import ResizeHandle from '../components/ResizeHandle'
import { INK_LOGICAL_WIDTH, MIN_INK_HEIGHT, type InkBlock } from '../formats/notedock'
import { InkEngine, type Selection } from '../ink/InkEngine'
import type { Stroke, Tool } from '../ink/model'

type Props = {
  block: InkBlock
  strokes: Stroke[]
  width: number
  /** 選択メニューの表示と「今の色にする」に使う。ツールの設定そのものは親がエンジンに直接反映する */
  tool: Tool
  penColor: string
  finger: boolean
  holdMs: number
  readOnly: boolean
  scroller: HTMLElement | null
  onEngine: (blockId: string, engine: InkEngine | null) => void
  onChange: (blockId: string, strokes: Stroke[]) => void
  onHistory: (blockId: string, canUndo: boolean, canRedo: boolean) => void
  onGrow: (blockId: string, y: number) => void
  /** 渡したときは、下端のつまみで高さを変えられる（混在ノート） */
  onResize?: (blockId: string, height: number) => void
}

/** 手書きブロック。横幅は表示幅に合わせ、論理座標（横幅1000）を拡大縮小して表示する */
function InkBlockView({ block, strokes, width, tool, penColor, finger, holdMs, readOnly, scroller, onEngine, onChange, onHistory, onGrow, onResize }: Props) {
  const startHeight = useRef(block.height)
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<InkEngine | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const scale = width / INK_LOGICAL_WIDTH
  // エンジンからは常に最新の値を読む
  const live = useRef({ scale, holdMs, finger, readOnly, scroller, onChange, onHistory, onGrow })
  useEffect(() => {
    live.current = { scale, holdMs, finger, readOnly, scroller, onChange, onHistory, onGrow }
  })

  useEffect(() => {
    const engine = new InkEngine(hostRef.current!, {
      scale: () => live.current.scale,
      scroller: () => live.current.scroller,
      holdMs: () => live.current.holdMs,
      fingerDraw: () => live.current.finger,
      readOnly: () => live.current.readOnly,
      onChange: (s) => live.current.onChange(block.id, s),
      onSelection: setSelection,
      onHistory: (u, r) => live.current.onHistory(block.id, u, r),
      onReachBottom: (y) => live.current.onGrow(block.id, y),
    })
    engine.setStrokes(strokes)
    engineRef.current = engine
    onEngine(block.id, engine)
    return () => {
      onEngine(block.id, null)
      engine.destroy()
      engineRef.current = null
    }
    // 線はエンジンが持つ。読み込み時だけ渡す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id])

  // 大きさ・拡大率が変わったら描き直す
  useEffect(() => {
    engineRef.current?.refresh()
  }, [width, block.height, scroller])

  const gridSize = 25 * scale
  const sel = selection?.bounds
  return (
    <div className="ink-block" style={{ width, height: block.height * scale }}>
      <div
        ref={hostRef}
        className={`ink-host ${block.background === 'grid' ? 'grid' : ''}`}
        style={{ backgroundSize: `${gridSize}px ${gridSize}px` }}
        aria-label="手書き"
      />
      {sel && tool === 'lasso' && (
        <div className="selection-toolbar" style={{ left: Math.max(4, Math.min(width - 200, sel.x * scale)), top: Math.max(4, sel.y * scale - 48) }}>
          <button className="btn small" onClick={() => engineRef.current?.recolorSelection(penColor)} title="今の色にする">
            <Palette size={16} /><span className="swatch" style={{ background: penColor }} />
          </button>
          <button className="btn small" onClick={() => engineRef.current?.duplicateSelection()}><Copy size={16} /> 複製</button>
          <button className="btn small btn-danger" onClick={() => engineRef.current?.deleteSelection()}><Trash2 size={16} /> 削除</button>
        </div>
      )}
      {onResize && !readOnly && (
        <ResizeHandle
          className="resize-bottom"
          label="ドラッグして高さを変える"
          onStart={() => (startHeight.current = block.height)}
          onDrag={(_dx, dy) => onResize(block.id, Math.max(MIN_INK_HEIGHT, Math.round(startHeight.current + dy / scale)))}
        />
      )}
    </div>
  )
}

// ツールを切り替えたときに、手書き面を作り直したり描き直したりしないようにする
export default memo(InkBlockView)
