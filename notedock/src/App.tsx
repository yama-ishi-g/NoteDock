import { useEffect, useState } from 'react'
import { appVersion } from './lib/version'
import LabPage from './lab/LabPage'

// 段階0の間だけ、#lab で検証ページを表示する
const isLab = () => window.location.hash.startsWith('#lab')

function App() {
  const [lab, setLab] = useState(isLab)

  useEffect(() => {
    const onHashChange = () => setLab(isLab())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  if (lab) return <LabPage />

  return (
    <main
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
      }}
    >
      <h1 style={{ margin: 0, fontSize: 32, fontWeight: 600 }}>NoteDock</h1>
      <p style={{ margin: 0, color: 'var(--text-muted)' }}>v{appVersion}</p>
      <a href="#lab" style={{ marginTop: 24, color: 'var(--accent)' }}>
        実機検証ページを開く
      </a>
    </main>
  )
}

export default App
