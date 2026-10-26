import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Banner, ErrorBoundary, Toasts } from './components/common'
import Dialogs from './components/Dialogs'
import LabPage from './lab/LabPage'
import ProjectList from './screens/ProjectList'
import ProjectView from './screens/ProjectView'
import SettingsScreen from './screens/Settings'
import { loadSettings } from './services/appData'
import { useAppStore } from './state/appStore'
import { requestPersist } from './storage'
import { isDevChannel, storageKey } from './lib/channel'

// 段階0の検証ページは #lab で開ける（設定画面からも開ける）
const isLab = () => window.location.hash.startsWith('#lab')

const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

const INSTALL_HINT_KEY = storageKey('installHintDismissed')

function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true })
  if (!needRefresh) return null
  return (
    <Banner onClose={() => setNeedRefresh(false)}>
      新しいバージョンがあります。
      <button className="btn btn-primary small" onClick={() => updateServiceWorker(true)}>再読み込み</button>
    </Banner>
  )
}

function InstallHint() {
  const [hidden, setHidden] = useState(() => {
    try {
      return isStandalone() || navigator.maxTouchPoints === 0 || localStorage.getItem(INSTALL_HINT_KEY) === '1'
    } catch {
      return isStandalone()
    }
  })
  if (hidden) return null
  return (
    <Banner
      onClose={() => {
        setHidden(true)
        try {
          localStorage.setItem(INSTALL_HINT_KEY, '1')
        } catch {
          // 記録できなくても動作に影響しない
        }
      }}
    >
      Safariの共有ボタンから「ホーム画面に追加」して使うと、データが消えにくくなります
    </Banner>
  )
}

function App() {
  const [lab, setLab] = useState(isLab)
  const view = useAppStore((s) => s.view)

  useEffect(() => {
    const onHashChange = () => setLab(isLab())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    loadSettings().then(useAppStore.getState().setSettings)
    requestPersist().then(useAppStore.getState().setPersisted)
  }, [])

  if (lab) return <LabPage />

  return (
    <ErrorBoundary>
      <div className="app">
        {isDevChannel && <div className="dev-band">開発版：本番とは別のデータで動いています</div>}
        <div className="banners">
          <UpdateBanner />
          <InstallHint />
        </div>
        {view.screen === 'list' && <ProjectList />}
        {view.screen === 'project' && <ProjectView key={view.projectId} projectId={view.projectId} />}
        {view.screen === 'settings' && <SettingsScreen back={view.back} />}
      </div>
      <Dialogs />
      <Toasts />
    </ErrorBoundary>
  )
}

export default App
