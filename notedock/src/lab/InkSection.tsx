import { useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type PointerEvent } from 'react'
import { InkPad, type EraserSize, type InkStats, type Tool } from './inkPad'
import { setResult } from './report'

// 0-5 Pencilの描き心地 / 0-6 直線化
const COLORS = ['#2c2c2a', '#e24b4a', '#378add', '#639922']
const ERASER_SIZES: [EraserSize, string][] = [['s', '小'], ['m', '中'], ['l', '大']]

// ツールの切り替えは、指やペンが触れた瞬間（pointerdown）に反映する。
// click は指を離した後に遅れて届くため、切り替えが遅く感じられる
function PressButton({ onPress, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { onPress: () => void }) {
  return (
    <button
      {...rest}
      onPointerDown={(e: PointerEvent) => {
        e.preventDefault()
        onPress()
      }}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') onPress()
      }}
    />
  )
}

export default function InkSection() {
  const boxRef = useRef<HTMLDivElement>(null)
  const padRef = useRef<InkPad | null>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [eraserSize, setEraserSize] = useState<EraserSize>('m')
  const [finger, setFinger] = useState(false)
  const [holdMs, setHoldMs] = useState(600)
  const [stats, setStats] = useState<InkStats | null>(null)
  const [snaps, setSnaps] = useState(0)
  const fingerRef = useRef(finger)
  const holdRef = useRef(holdMs)

  useEffect(() => {
    fingerRef.current = finger
    holdRef.current = holdMs
  }, [finger, holdMs])

  useEffect(() => {
    const pad = new InkPad(boxRef.current!, {
      holdMs: () => holdRef.current,
      fingerDraw: () => fingerRef.current,
      touchMode: () => 'manual',
      onStats: setStats,
      onSnap: () => setSnaps((n) => n + 1),
    })
    padRef.current = pad
    return () => pad.destroy()
  }, [])

  // 再描画を待たずに、手書き面へ即座に反映する
  const selectTool = (t: Tool) => {
    if (padRef.current) padRef.current.tool = t
    setTool(t)
  }
  const selectColor = (c: string) => {
    if (padRef.current) {
      padRef.current.color = c
      if (padRef.current.tool === 'eraser') padRef.current.tool = 'pen'
    }
    setColor(c)
    setTool((t) => (t === 'eraser' ? 'pen' : t))
  }
  const undo = () => padRef.current?.undo()
  const clearAll = () => padRef.current?.clear()
  const selectEraserSize = (size: EraserSize) => {
    if (padRef.current) {
      padRef.current.eraserSize = size
      padRef.current.tool = 'eraser'
    }
    setEraserSize(size)
    setTool('eraser')
  }

  useEffect(() => {
    if (!stats) return
    setResult('0-5 入力', `種類=${stats.pointerType} 筆圧=${stats.pressure.toFixed(2)} イベント/秒=${stats.eventsPerSec} まとめ数=${stats.coalescedAvg.toFixed(1)} 入力→描画=${stats.latencyMs.toFixed(1)}ms 手のひら除外=${stats.palmRejected} cancel=${stats.cancels}`)
  }, [stats])
  useEffect(() => {
    setResult('0-6 直線化', `${snaps} 回発生（保持時間 ${holdMs}ms）`)
  }, [snaps, holdMs])

  return (
    <section id="lab-ink">
      <h2>0-5 描き心地 / 0-6 直線化</h2>
      <div className="row">
        <PressButton className={tool === 'pen' ? 'on' : ''} onPress={() => selectTool('pen')}>ペン</PressButton>
        <PressButton className={tool === 'marker' ? 'on' : ''} onPress={() => selectTool('marker')}>マーカー</PressButton>
        <PressButton className={tool === 'eraser' ? 'on' : ''} onPress={() => selectTool('eraser')}>消しゴム</PressButton>
        {ERASER_SIZES.map(([size, label]) => (
          <PressButton key={size} className={tool === 'eraser' && eraserSize === size ? 'on' : ''} onPress={() => selectEraserSize(size)}>{label}</PressButton>
        ))}
        {COLORS.map((c) => (
          <PressButton key={c} aria-label={c} onPress={() => selectColor(c)}
            style={{ width: 30, height: 30, padding: 0, borderRadius: '50%', background: c, outline: color === c ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }} />
        ))}
        <PressButton className={finger ? 'on' : ''} onPress={() => setFinger((v) => !v)}>指で描く {finger ? 'ON' : 'OFF'}</PressButton>
        <PressButton onPress={undo}>元に戻す</PressButton>
        <PressButton onPress={clearAll}>全消去</PressButton>
      </div>
      <div className="row">
        <label>直線化の保持時間 {holdMs}ms</label>
        <input type="range" min={300} max={1500} step={100} value={holdMs} onChange={(e) => setHoldMs(Number(e.target.value))} />
      </div>
      <div ref={boxRef} style={{ height: 420, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg)', userSelect: 'none', WebkitUserSelect: 'none' }} />
      <dl className="kv" style={{ marginTop: 8 }}>
        <dt>入力の種類</dt><dd>{stats?.pointerType ?? '-'}</dd>
        <dt>筆圧</dt><dd>{stats ? stats.pressure.toFixed(2) : '-'}</dd>
        <dt>イベント/秒</dt><dd>{stats?.eventsPerSec ?? '-'}（まとめ数 平均 {stats ? stats.coalescedAvg.toFixed(1) : '-'}）</dd>
        <dt>入力→描画</dt><dd>{stats ? `${stats.latencyMs.toFixed(1)} ms` : '-'}</dd>
        <dt>手のひら除外</dt><dd>{stats?.palmRejected ?? 0} 回</dd>
        <dt>直線化</dt><dd>{snaps} 回</dd>
      </dl>
      <p className="hint">
        確認: 線がペン先に遅れずについてくるか / 筆圧で太さが変わるか / 手をついて描いても余計な線が出ないか（指で描くONでも試す） / 線の最後で止めると直線になり、離すまで向きを変えられるか / 消しゴムでなぞった部分だけ消えるか / 「元に戻す」で描いた線・消した部分・全消去が1つずつ戻るか
      </p>
    </section>
  )
}
