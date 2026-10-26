import { ArrowLeft, BookOpen, FlaskConical, HardDrive, Share, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { exportAllZip } from '../io/projectZip'
import { shareFile } from '../io/share'
import { formatBuildLabel } from '../lib/version'
import { markBackedUp } from '../services/appData'
import { createHowToProject } from '../services/howto'
import { readErrorLog, reportError, useAppStore, type View } from '../state/appStore'
import { dialogs } from '../state/dialogs'
import { getStorage, requestPersist } from '../storage'

const fmtMB = (n: number) => (n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

export default function SettingsScreen({ back }: { back: View }) {
  const navigate = useAppStore((s) => s.navigate)
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const persisted = useAppStore((s) => s.persisted)
  const setPersisted = useAppStore((s) => s.setPersisted)
  const toast = useAppStore((s) => s.toast)
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  const [errors] = useState(readErrorLog)

  useEffect(() => {
    getStorage().estimate().then(setEstimate).catch(() => setEstimate(null))
  }, [])

  const exportAll = async () => {
    try {
      const file = await exportAllZip()
      const ok = await dialogs.confirm({ title: '書き出しの準備ができました', message: `${file.name}（${fmtMB(file.size)}）`, okLabel: '共有・保存' })
      if (!ok) return
      const result = await shareFile(file)
      if (result !== 'cancelled') {
        await markBackedUp()
        toast(result === 'downloaded' ? 'ダウンロードしました' : '書き出しました')
      }
    } catch (err) {
      reportError(err, '書き出せませんでした: ')
    }
  }

  return (
    <div className="screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => navigate(back)} aria-label="戻る"><ArrowLeft size={20} /></button>
        <h1 className="screen-title">設定</h1>
      </header>
      <main className="settings">
        <section>
          <h2>手書き</h2>
          <label className="setting-row">
            <span>直線化の保持時間</span>
            <span className="setting-control">
              <input type="range" min={300} max={1500} step={100} value={settings.lineSnapHoldMs}
                onChange={(e) => void updateSettings({ lineSnapHoldMs: Number(e.target.value) })} />
              <span className="value">{(settings.lineSnapHoldMs / 1000).toFixed(1)}秒</span>
            </span>
          </label>
          <label className="setting-row">
            <span>新しく開いたファイルで「指で描く」をONにする</span>
            <input type="checkbox" checked={settings.fingerDrawDefault} onChange={(e) => void updateSettings({ fingerDrawDefault: e.target.checked })} />
          </label>
        </section>

        <section>
          <h2>エディタ</h2>
          <div className="setting-row">
            <span>フォント</span>
            <span className="segmented">
              <button className={settings.editorFont === 'sans' ? 'on' : ''} onClick={() => void updateSettings({ editorFont: 'sans' })}>標準</button>
              <button className={settings.editorFont === 'mono' ? 'on' : ''} onClick={() => void updateSettings({ editorFont: 'mono' })}>等幅</button>
            </span>
          </div>
        </section>

        <section>
          <h2>データ</h2>
          <div className="setting-row">
            <span><HardDrive size={16} /> ストレージ</span>
            <span className="muted">{estimate ? `使用 ${fmtMB(estimate.usage)} / 空き ${fmtMB(Math.max(0, estimate.quota - estimate.usage))}` : '-'}</span>
          </div>
          <div className="setting-row">
            <span><ShieldCheck size={16} /> データの保護</span>
            <span className="setting-control">
              <span className={persisted ? 'ok' : 'muted'}>{persisted === null ? '確認中' : persisted ? '保護されている' : '保護されていない'}</span>
              {!persisted && <button className="btn small" onClick={async () => setPersisted(await requestPersist())}>保護を依頼</button>}
            </span>
          </div>
          <p className="muted small">「保護されている」と、空き容量が少なくなってもブラウザがデータを消しにくくなります。ホーム画面に追加して使うと保護されやすくなります。</p>
          <div className="setting-row">
            <span>全データの書き出し</span>
            <button className="btn" onClick={exportAll}><Share size={16} /> ZIPで書き出す</button>
          </div>
          <p className="muted small">すべてのプロジェクトを1つのZIPにします。一覧の「読み込み」で、プロジェクトごとに戻せます。</p>
        </section>

        <section>
          <h2>このアプリについて</h2>
          <div className="setting-row">
            <span><BookOpen size={16} /> 使い方</span>
            <button className="btn" onClick={async () => {
              try {
                const id = await createHowToProject()
                toast('使い方プロジェクトを追加しました')
                navigate({ screen: 'project', projectId: id })
              } catch (err) {
                reportError(err, '追加できませんでした: ')
              }
            }}>使い方プロジェクトを追加</button>
          </div>
          <div className="setting-row">
            <span>バージョン</span>
            <span className="muted">{formatBuildLabel()}</span>
          </div>
          <div className="setting-row">
            <span>実機検証ページ</span>
            <a className="btn" href="#lab"><FlaskConical size={16} /> 開く</a>
          </div>
          {errors.length > 0 && (
            <details>
              <summary className="muted">最近のエラー（{errors.length}件）</summary>
              <pre className="error-log">{errors.map((e) => `${new Date(e.at).toLocaleString('ja-JP')}  ${e.message}`).join('\n')}</pre>
            </details>
          )}
        </section>
      </main>
    </div>
  )
}
