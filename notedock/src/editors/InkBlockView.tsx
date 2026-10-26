import { Copy, Palette, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { INK_LOGICAL_WIDTH, type InkBlock } from '../formats/notedock'
import { InkEngine, type Selection } from '../ink/InkEngine'
import type { ToolState } from '../ink/InkToolbar'
import type { Stroke } from '../ink/model'

type Props = {
  block: InkBlock
  strokes: Stroke[]
  width: number
  tools: ToolState
  holdMs: number
  readOnly: boolean
  scroller: HTMLElement | null
  onEngine: (blockId: string, engine: InkEngine | null) => void
  onChange: (blockId: string, strokes: Stroke[]) => void
  onHistory: (blockId: string, canUndo: boolean, canRedo: boolean) => void
  onGrow: (blockId: string, y: number) => void
}

/** 手書きブロック。横幅は表示幅に合わせ、論理座標（横幅1000）を拡大縮小して表示する */
export default function InkBlockView({ block, strokes, width, tools, holdMs, readOnly, scroller, onEngine, onChange, onHistory, onGrow }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<InkEngine | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const scale = width / INK_LOGICAL_WIDTH
  // エンジンからは常に最新の値を読む
  const live = useRef({ scale, holdMs, finger: tools.finger, readOnly, scroller, onChange, onHistory, onGrow })
  useEffect(() => {
    live.current = { scale, holdMs, finger: tools.finger, readOnly, scroller, onChange, onHistory, onGrow }
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

  // ツールの設定をエンジンに反映する
  useEffect(() => {
    const e = engineRef.current
    if (!e) return
    e.setTool(tools.tool)
    e.color = tools.penColor
    e.markerColor = tools.markerColor
    e.penLevel = tools.penLevel
    e.markerLevel = tools.markerLevel
    e.eraserLevel = tools.eraserLevel
  }, [tools])

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
      {sel && tools.tool === 'lasso' && (
        <div className="selection-toolbar" style={{ left: Math.max(4, Math.min(width - 200, sel.x * scale)), top: Math.max(4, sel.y * scale - 48) }}>
          <button className="btn small" onClick={() => engineRef.current?.recolorSelection(tools.penColor)} title="今の色にする">
            <Palette size={16} /><span className="swatch" style={{ background: tools.penColor }} />
          </button>
          <button className="btn small" onClick={() => engineRef.current?.duplicateSelection()}><Copy size={16} /> 複製</button>
          <button className="btn small btn-danger" onClick={() => engineRef.current?.deleteSelection()}><Trash2 size={16} /> 削除</button>
        </div>
      )}
    </div>
  )
}
