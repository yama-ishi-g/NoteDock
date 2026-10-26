import { appVersion } from './lib/version'

function App() {
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
    </main>
  )
}

export default App
