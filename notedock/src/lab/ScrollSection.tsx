import { useEffect, useRef, useState } from 'react'
import { InkPad, type InkStats } from './inkPad'
import { setResult } from './report'

// 0-8 手書き枠の中で指スクロールが自然にできるか（混在ノートを想定）
type Mode = 'manual' | 'native'

const filler = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => (
    <p key={i} style={{ margin: '6px 0' }}>
      テキストブロック {from + i}：指でここをなぞってスクロールし、そのまま手書き枠の中でもスクロールしてみてください。
    </p>
  ))

export default function ScrollSection() {
  const scrollRef = useRef<HTMLDivElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const padRef = useRef<InkPad | null>(null)
  const [mode, setMode] = useState<Mode>('manual')
  const [stats, setStats] = useState<InkStats | null>(null)
  const modeRef = useRef(mode)

  useEffect(() => {
    const pad = new InkPad(boxRef.current!, {
      holdMs: () => 600,
      fingerDraw: () => false,
      touchMode: () => modeRef.current,
      panInertia: true,
      onPan: (_dx, dy) => {
        if (scrollRef.current) scrollRef.current.scrollTop -= dy
      },
      onStats: setStats,
    })
    padRef.current = pad
    return () => pad.destroy()
  }, [])

  useEffect(() => {
    modeRef.current = mode
    padRef.current?.applyTouchAction()
    setResult('0-8 方式', mode === 'manual' ? 'A: touch-action none＋自前スクロール（弱い慣性）' : 'B: touch-action pan-y（ブラウザ標準）')
  }, [mode])
  useEffect(() => {
    if (stats) setResult(`0-8 ${mode} pointercancel`, `${stats.cancels} 回（ペンの線が途切れた回数の目安）`)
  }, [stats, mode])

  return (
    <section id="lab-scroll">
      <h2>0-8 手書き枠の中の指スクロール</h2>
      <div className="row">
        <button className={mode === 'manual' ? 'on' : ''} onClick={() => setMode('manual')}>方式A：自前スクロール（弱い慣性）</button>
        <button className={mode === 'native' ? 'on' : ''} onClick={() => setMode('native')}>方式B：ブラウザ標準</button>
        <button onClick={() => padRef.current?.clear()}>全消去</button>
      </div>
      <p className="hint">
        方式A: 枠内の指の動きをプログラムでスクロールに変換（指を弾くと少しだけ流れる）。方式B: ブラウザ任せ（慣性あり。ただしPencilでもスクロールしてしまう可能性）。両方試して比べてください。
      </p>
      <div ref={scrollRef} style={{ height: 420, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '0 12px' }}>
        {filler(1, 6)}
        <div
          ref={boxRef}
          style={{
            height: 300,
            margin: '8px 0',
            border: '1px dashed var(--accent)',
            borderRadius: 8,
            userSelect: 'none',
            WebkitUserSelect: 'none',
            backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />
        {filler(7, 10)}
      </div>
      <p className="hint">ペンの線が途切れた回数（pointercancel）: {stats?.cancels ?? 0}</p>
    </section>
  )
}
