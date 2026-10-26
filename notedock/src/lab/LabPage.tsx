import { useState } from 'react'
import './lab.css'
import { getReportText } from './report'
import EnvSection from './EnvSection'
import OpfsSection from './OpfsSection'
import InkSection from './InkSection'
import ScribbleSection from './ScribbleSection'
import ScrollSection from './ScrollSection'
import FilesSection from './FilesSection'
import PdfSection from './PdfSection'

const sections = [
  ['env', '0-1/0-4 PWA・保持'],
  ['opfs', '0-2/0-3 保存'],
  ['ink', '0-5/0-6 手書き'],
  ['scribble', '0-7 Scribble'],
  ['scroll', '0-8 スクロール'],
  ['files', '0-9 ファイル'],
  ['pdf', '0-10 PDF'],
] as const

export default function LabPage() {
  const [copied, setCopied] = useState('')
  const [reportText, setReportText] = useState('')

  const copyReport = async () => {
    const text = getReportText()
    try {
      await navigator.clipboard.writeText(text)
      setCopied('コピーしました')
    } catch {
      setCopied('コピーできませんでした（下の欄から手動でコピーしてください）')
    }
    setReportText(text)
  }

  return (
    <div className="lab">
      <div className="row">
        <a href="#" style={{ color: 'var(--accent)' }}>← NoteDock</a>
        <h1 style={{ flex: 1 }}>実機検証（段階0）</h1>
        <button onClick={copyReport}>結果をコピー</button>
      </div>
      {copied && <p className="hint">{copied}</p>}
      {reportText && <textarea readOnly value={reportText} style={{ minHeight: 160, fontSize: 12 }} />}
      <nav>
        {sections.map(([id, label]) => (
          <a key={id} href={`#lab-${id}`} onClick={(e) => {
            e.preventDefault()
            document.getElementById(`lab-${id}`)?.scrollIntoView({ behavior: 'smooth' })
          }}>{label}</a>
        ))}
      </nav>
      <EnvSection />
      <OpfsSection />
      <InkSection />
      <ScribbleSection />
      <ScrollSection />
      <FilesSection />
      <PdfSection />
    </div>
  )
}
