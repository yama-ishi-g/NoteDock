import { useState } from 'react'
import { setResult } from './report'

// 0-7 Scribble（Pencilで書いた文字がテキストになるか）
const CHECKS = ['textareaで文字になった', '消す・選択ジェスチャーが効いた', 'contenteditableでも文字になった']

export default function ScribbleSection() {
  const [text, setText] = useState('')
  const [rich, setRich] = useState('')
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  const toggle = (key: string) => {
    const next = { ...checked, [key]: !checked[key] }
    setChecked(next)
    setResult('0-7 Scribble', Object.entries(next).filter(([, v]) => v).map(([k]) => k).join(', ') || '未確認')
  }

  return (
    <section id="lab-scribble">
      <h2>0-7 Scribble</h2>
      <p className="hint">Apple Pencilで下の欄に直接文字を書いてください（iPadの設定 → Apple Pencil → スクリブル がONであること）</p>
      <label className="hint">textarea（.txt / .md・ノートで使う予定）</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="ここにPencilで書く" />
      <label className="hint">contenteditable（比較用）</label>
      <div contentEditable suppressContentEditableWarning onInput={(e) => setRich(e.currentTarget.textContent ?? '')} />
      <p className="hint">文字数: textarea {text.length} / contenteditable {rich.length}</p>
      <div className="row">
        {CHECKS.map((k) => (
          <button key={k} className={checked[k] ? 'on' : ''} onClick={() => toggle(k)}>{k}</button>
        ))}
      </div>
    </section>
  )
}
