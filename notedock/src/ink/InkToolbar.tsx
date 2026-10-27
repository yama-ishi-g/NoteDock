import { Circle, Eraser, Grid3x3, Hand, Highlighter, ImagePlus, Lasso, MousePointer2, MoveUpRight, PenLine, RectangleHorizontal, Redo2, Shapes, Square, Type, Undo2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import PressButton from '../components/PressButton'
import type { InkBackground } from '../formats/notedock'
import { ERASER_RADII, MARKER_SIZES, PEN_SIZES, PRESET_COLORS, type ShapeKind, type SizeLevel, type Tool } from './model'

export type ToolState = {
  tool: Tool
  penColor: string
  markerColor: string
  penLevel: SizeLevel
  markerLevel: SizeLevel
  eraserLevel: SizeLevel
  textLevel: SizeLevel
  textColor: string
  /** 図形ツールで描く図形（色・太さはペンと同じ） */
  shapeKind: ShapeKind
  finger: boolean
}

type Props = {
  state: ToolState
  onChange: (patch: Partial<ToolState>) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  background?: InkBackground
  onBackground?: (bg: InkBackground) => void
  /** 画像を置く（写真・カメラ・ファイルから選ぶ） */
  onInsertImage?: () => void
}

const TOOLS: { tool: Tool; label: string; icon: React.ReactNode }[] = [
  { tool: 'pen', label: 'ペン', icon: <PenLine size={20} /> },
  { tool: 'marker', label: 'マーカー', icon: <Highlighter size={20} /> },
  { tool: 'eraser', label: '消しゴム', icon: <Eraser size={20} /> },
  { tool: 'shape', label: '図形（円・長方形・矢印）', icon: <Shapes size={20} /> },
  { tool: 'lasso', label: '投げ縄', icon: <Lasso size={20} /> },
  { tool: 'select', label: '選択（画像・テキストを動かす）', icon: <MousePointer2 size={20} /> },
  { tool: 'text', label: 'テキストボックス', icon: <Type size={20} /> },
]

const SHAPES: { kind: ShapeKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'ellipse', label: '円', icon: <Circle size={20} /> },
  { kind: 'rect', label: '長方形', icon: <RectangleHorizontal size={20} /> },
  { kind: 'arrow', label: '矢印', icon: <MoveUpRight size={20} /> },
]

/** 太さの見本（丸の大きさ） */
function sizeDots(tool: Tool): number[] {
  if (tool === 'text' || tool === 'select') return [10, 15, 21]
  const sizes = tool === 'marker' ? MARKER_SIZES : tool === 'eraser' ? ERASER_RADII.map((r) => r * 2) : PEN_SIZES
  const max = Math.max(...sizes)
  return sizes.map((s) => 6 + (s / max) * 14)
}

export default function InkToolbar({ state, onChange, canUndo, canRedo, onUndo, onRedo, background, onBackground, onInsertImage }: Props) {
  const { tool } = state
  const textTool = tool === 'text' || tool === 'select'
  const colorTool = tool === 'marker' ? 'marker' : textTool ? 'text' : 'pen'
  const color = colorTool === 'marker' ? state.markerColor : colorTool === 'text' ? state.textColor : state.penColor
  const levelKey = tool === 'marker' ? 'markerLevel' : tool === 'eraser' ? 'eraserLevel' : textTool ? 'textLevel' : 'penLevel'
  const showSizes = tool !== 'lasso'
  const barRef = useRef<HTMLDivElement>(null)

  // Pencil でボタンをタップすると、iPadOS が文字選択・Scribble の始まりかどうかを見極める間（0.数秒）、
  // 次の Pencil の入力を手書き面に渡さない。touchstart を止めて、OS 標準の処理を始めさせない（段階2の実機確認で判明）。
  // React の onTouchStart は passive で preventDefault が効かないため、直接登録する
  useEffect(() => {
    const bar = barRef.current!
    const onTouchStart = (e: TouchEvent) => {
      // 「ほかの色」は OS の色選択を開くため、標準の処理に任せる
      if ((e.target as HTMLElement).closest('.color-btn.custom')) return
      e.preventDefault()
    }
    bar.addEventListener('touchstart', onTouchStart, { passive: false })
    return () => bar.removeEventListener('touchstart', onTouchStart)
  }, [])

  const setColor = (c: string) =>
    onChange(colorTool === 'marker' ? { markerColor: c } : colorTool === 'text' ? { textColor: c } : { penColor: c, tool: tool === 'eraser' ? 'pen' : tool })

  return (
    <div ref={barRef} className="ink-toolbar" role="toolbar" aria-label="手書きツール">
      <div className="ink-group">
        {TOOLS.map((t) => (
          <PressButton key={t.tool} className={`tool-btn ${tool === t.tool ? 'on' : ''}`} aria-label={t.label} title={t.label} aria-pressed={tool === t.tool} onPress={() => onChange({ tool: t.tool })}>
            {t.icon}
          </PressButton>
        ))}
      </div>

      {tool === 'shape' && (
        <div className="ink-group">
          {SHAPES.map((s) => (
            <PressButton key={s.kind} className={`tool-btn ${state.shapeKind === s.kind ? 'on' : ''}`} aria-label={s.label} title={s.label} aria-pressed={state.shapeKind === s.kind} onPress={() => onChange({ shapeKind: s.kind })}>
              {s.icon}
            </PressButton>
          ))}
        </div>
      )}

      {showSizes && (
        <div className="ink-group">
          {sizeDots(tool).map((d, i) => (
            <PressButton key={i} className={`tool-btn size ${state[levelKey] === i ? 'on' : ''}`} aria-label={(textTool ? ['小', '中', '大'] : ['細', '中', '太'])[i]} title={(textTool ? ['文字 小', '文字 中', '文字 大'] : ['細', '中', '太'])[i]} onPress={() => onChange({ [levelKey]: i as SizeLevel })}>
              {textTool ? (
                <span className="size-letter" style={{ fontSize: d, color }}>あ</span>
              ) : (
                <span className="size-dot" style={{ width: d, height: d, background: tool === 'eraser' ? 'transparent' : color, borderColor: tool === 'eraser' ? 'currentColor' : color }} />
              )}
            </PressButton>
          ))}
        </div>
      )}

      {tool !== 'eraser' && (
        <div className="ink-group colors">
          {PRESET_COLORS.map((c) => (
            <PressButton key={c} className={`color-btn ${color === c ? 'on' : ''}`} style={{ background: c }} aria-label={`色 ${c}`} onPress={() => setColor(c)} />
          ))}
          <label className={`color-btn custom ${PRESET_COLORS.includes(color as (typeof PRESET_COLORS)[number]) ? '' : 'on'}`} title="ほかの色" style={{ background: PRESET_COLORS.includes(color as (typeof PRESET_COLORS)[number]) ? undefined : color }}>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label="ほかの色" />
          </label>
        </div>
      )}

      {onInsertImage && (
        <div className="ink-group">
          <PressButton className="tool-btn" aria-label="画像を置く" title="画像を置く" onRelease={onInsertImage}><ImagePlus size={20} /></PressButton>
        </div>
      )}

      <div className="spacer" />

      <div className="ink-group">
        <PressButton className="tool-btn" aria-label="元に戻す" title="元に戻す" disabled={!canUndo} onPress={onUndo}><Undo2 size={20} /></PressButton>
        <PressButton className="tool-btn" aria-label="やり直し" title="やり直し" disabled={!canRedo} onPress={onRedo}><Redo2 size={20} /></PressButton>
      </div>
      <div className="ink-group">
        {onBackground && (
          <PressButton className="tool-btn" aria-label={background === 'grid' ? '方眼をやめる' : '方眼にする'} title="背景（無地／方眼）" onPress={() => onBackground(background === 'grid' ? 'plain' : 'grid')}>
            {background === 'grid' ? <Grid3x3 size={20} /> : <Square size={20} />}
          </PressButton>
        )}
        <PressButton className={`tool-btn finger ${state.finger ? 'on' : ''}`} aria-pressed={state.finger} title="指で描く" onPress={() => onChange({ finger: !state.finger })}>
          <Hand size={20} />
          <span className="finger-label">{state.finger ? '指で描く' : '指でスクロール'}</span>
        </PressButton>
      </div>
    </div>
  )
}
