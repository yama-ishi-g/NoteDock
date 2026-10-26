import { useEffect, useState } from 'react'
import { opfsReadText, opfsWrite } from './opfsClient'
import { setResult } from './report'

// 0-1 PWA化とホーム画面追加 / 0-4 データの保持
type LaunchRecord = { firstLaunch: string; lastLaunch: string; launches: number }

const RECORD_PATH = 'lab/launch.json'

const fmtMB = (n?: number) => (n === undefined ? '-' : `${(n / 1024 / 1024).toFixed(1)} MB`)

export default function EnvSection() {
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const [online, setOnline] = useState(navigator.onLine)
  const [sw, setSw] = useState('確認中')
  const [persisted, setPersisted] = useState<string>('確認中')
  const [estimate, setEstimate] = useState<StorageEstimate>()
  const [record, setRecord] = useState<LaunchRecord | null>(null)
  const [recordError, setRecordError] = useState('')

  useEffect(() => {
    const on = () => setOnline(navigator.onLine)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)

    navigator.serviceWorker?.getRegistration().then((reg) => {
      setSw(reg?.active ? (navigator.serviceWorker.controller ? '有効（このページを制御中）' : '登録済み（再読み込みで有効）') : '未登録')
    })
    navigator.storage?.persisted?.().then((p) => setPersisted(p ? '保護されている' : '保護されていない'))
    navigator.storage?.estimate?.().then(setEstimate)

    // 起動記録: 初回起動日時を残し、後日データが残っているかを確認する
    ;(async () => {
      let rec: LaunchRecord
      try {
        rec = JSON.parse(await opfsReadText(RECORD_PATH))
        rec = { ...rec, lastLaunch: new Date().toISOString(), launches: rec.launches + 1 }
      } catch {
        const now = new Date().toISOString()
        rec = { firstLaunch: now, lastLaunch: now, launches: 1 }
      }
      try {
        await opfsWrite(RECORD_PATH, JSON.stringify(rec))
        setRecord(rec)
      } catch (err) {
        setRecordError(String(err))
      }
    })()

    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', on)
    }
  }, [])

  useEffect(() => {
    setResult('0-1 表示モード', standalone ? 'standalone（ホーム画面から起動）' : 'ブラウザのタブ')
    setResult('0-1 ServiceWorker', sw)
    setResult('0-1 UA', navigator.userAgent)
    setResult('0-4 persist', persisted)
    setResult('0-4 容量', `使用 ${fmtMB(estimate?.usage)} / 上限 ${fmtMB(estimate?.quota)}`)
    if (record) setResult('0-4 起動記録', `初回 ${new Date(record.firstLaunch).toLocaleString('ja-JP')} / 起動 ${record.launches} 回`)
    if (recordError) setResult('0-4 起動記録', `保存失敗: ${recordError}`)
  }, [standalone, sw, persisted, estimate, record, recordError])

  const requestPersist = async () => {
    const granted = await navigator.storage?.persist?.()
    setPersisted(granted ? '保護されている' : '保護されていない（拒否または未対応）')
  }

  return (
    <section id="lab-env">
      <h2>0-1 PWA化 / 0-4 データの保持</h2>
      <dl className="kv">
        <dt>表示モード</dt>
        <dd className={standalone ? 'ok' : 'ng'}>{standalone ? 'ホーム画面から起動（standalone）' : 'ブラウザのタブで表示中'}</dd>
        <dt>ネットワーク</dt>
        <dd>{online ? 'オンライン' : 'オフライン'}</dd>
        <dt>Service Worker</dt>
        <dd>{sw}</dd>
        <dt>データ保護</dt>
        <dd>{persisted}</dd>
        <dt>容量</dt>
        <dd>使用 {fmtMB(estimate?.usage)} / 上限 {fmtMB(estimate?.quota)}</dd>
        <dt>初回起動</dt>
        <dd>{record ? new Date(record.firstLaunch).toLocaleString('ja-JP') : recordError || '-'}</dd>
        <dt>起動回数</dt>
        <dd>{record?.launches ?? '-'}</dd>
      </dl>
      <div className="row">
        <button onClick={requestPersist}>データ保護を依頼（persist）</button>
      </div>
      <p className="hint">
        確認手順: ①Safariの共有→「ホーム画面に追加」 ②ホーム画面から起動し「standalone」になるか ③機内モードにして再起動しても開けるか ④アプリを終了・数日後に開き、初回起動日時が残っているか
      </p>
    </section>
  )
}
