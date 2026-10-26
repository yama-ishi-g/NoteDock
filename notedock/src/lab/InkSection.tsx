import { useEffect, useRef, useState } from 'react'
import { InkPad, type InkStats, type Tool } from './inkPad'
import { setResult } from './report'

// 0-5 Pencilの描き心地 / 0-6 直線化
const COLORS = ['#2c2c2a', '#e24b4a', '#378add', '#639922']

export default function InkSection() {
  const boxRef = useRef<HTMLDivElement>(null)
  const padRef = useRef<InkPad | null>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLORS[0])
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

  useEffect(() => {
    if (padRef.current) {
      padRef.current.tool = tool
      padRef.current.color = color
    }
  }, [tool, color])

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
        <button className={tool === 'pen' ? 'on' : ''} onClick={() => setTool('pen')}>ペン</button>
        <button className={tool === 'marker' ? 'on' : ''} onClick={() => setTool('marker')}>マーカー</button>
        <button className={tool === 'eraser' ? 'on' : ''} onClick={() => setTool('eraser')}>消しゴム</button>
        {COLORS.map((c) => (
          <button key={c} aria-label={c} onClick={() => setColor(c)}
            style={{ width: 30, height: 30, padding: 0, borderRadius: '50%', background: c, outline: color === c ? '2px solid var(--accent)' : 'none', outlineOffset: 2 }} />
        ))}
        <button className={finger ? 'on' : ''} onClick={() => setFinger((v) => !v)}>指で描く {finger ? 'ON' : 'OFF'}</button>
        <button onClick={() => padRef.current?.undo()}>元に戻す</button>
        <button onClick={() => padRef.current?.clear()}>全消去</button>
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
