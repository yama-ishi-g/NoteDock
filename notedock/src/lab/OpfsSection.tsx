import { useState } from 'react'
import { getDir, opfsExists, opfsMove, opfsProbe, opfsReadText, opfsWrite } from './opfsClient'
import { setResult } from './report'

// 0-2 OPFSの書き込み（Worker） / 0-3 move() の可否
type Step = { name: string; ok: boolean; detail: string }

const BASE = 'lab/opfs-test'

async function runTests(): Promise<Step[]> {
  const steps: Step[] = []
  const step = async (name: string, fn: () => Promise<string | void>) => {
    try {
      const detail = (await fn()) ?? ''
      steps.push({ name, ok: true, detail })
    } catch (err) {
      steps.push({ name, ok: false, detail: String(err) })
    }
  }

  await step('OPFSのルートを取得', async () => {
    await navigator.storage.getDirectory()
  })
  await step('Workerの機能確認', async () => {
    const p = await opfsProbe()
    if (!p.syncAccessHandle) throw new Error('createSyncAccessHandle がありません')
    return `syncAccessHandle=${p.syncAccessHandle} move=${p.move}`
  })
  await step('メインスレッドの機能確認', async () => {
    const root = await navigator.storage.getDirectory()
    const fh = await root.getFileHandle('lab-main-probe.tmp', { create: true })
    const info = `createWritable=${'createWritable' in fh} move=${'move' in fh}`
    await root.removeEntry('lab-main-probe.tmp')
    return info
  })
  await step('入れ子のフォルダ作成', async () => {
    await getDir(`${BASE}/a/b/c`, true)
  })
  await step('書き込み（日本語のファイル名）→ 読み込み', async () => {
    await opfsWrite(`${BASE}/a/メモ.txt`, 'こんにちは NoteDock')
    const text = await opfsReadText(`${BASE}/a/メモ.txt`)
    if (text !== 'こんにちは NoteDock') throw new Error(`内容が違う: ${text}`)
  })
  await step('短い内容で上書き（切り詰め）', async () => {
    await opfsWrite(`${BASE}/a/メモ.txt`, 'hi')
    const text = await opfsReadText(`${BASE}/a/メモ.txt`)
    if (text !== 'hi') throw new Error(`内容が違う: ${text}`)
  })
  await step('5MBのバイナリを書き込み', async () => {
    const data = new Uint8Array(5 * 1024 * 1024)
    for (let i = 0; i < data.length; i += 4096) data[i] = i % 251
    const t = performance.now()
    await opfsWrite(`${BASE}/a/big.bin`, data)
    const ms = performance.now() - t
    const dir = await getDir(`${BASE}/a`)
    const size = (await (await dir.getFileHandle('big.bin')).getFile()).size
    if (size !== data.length) throw new Error(`サイズが違う: ${size}`)
    return `${ms.toFixed(0)} ms`
  })
  await step('名前の変更（move・同じフォルダ）', async () => {
    await opfsMove(`${BASE}/a/メモ.txt`, `${BASE}/a`, 'メモ（改名）.txt')
    if (!(await opfsExists(`${BASE}/a/メモ（改名）.txt`))) throw new Error('改名後のファイルがない')
    if (await opfsExists(`${BASE}/a/メモ.txt`)) throw new Error('元のファイルが残っている')
  })
  await step('別フォルダへ移動（move）', async () => {
    await opfsMove(`${BASE}/a/メモ（改名）.txt`, `${BASE}/a/b/c`, 'moved.txt')
    if ((await opfsReadText(`${BASE}/a/b/c/moved.txt`)) !== 'hi') throw new Error('移動後の内容が違う')
  })
  await step('安全な上書き（tmpに書く→削除→改名）', async () => {
    await opfsWrite(`${BASE}/a/doc.json`, '{"v":1}')
    await opfsWrite(`${BASE}/a/doc.json.tmp`, '{"v":2}')
    const dir = await getDir(`${BASE}/a`)
    await dir.removeEntry('doc.json')
    await opfsMove(`${BASE}/a/doc.json.tmp`, `${BASE}/a`, 'doc.json')
    if ((await opfsReadText(`${BASE}/a/doc.json`)) !== '{"v":2}') throw new Error('内容が違う')
  })
  await step('フォルダの一覧', async () => {
    const dir = await getDir(`${BASE}/a`)
    const names: string[] = []
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name)
    return names.sort().join(', ')
  })
  await step('フォルダごと削除', async () => {
    const parent = await getDir('lab')
    await parent.removeEntry('opfs-test', { recursive: true })
    if (await opfsExists(`${BASE}/a/doc.json`)) throw new Error('削除されていない')
  })
  return steps
}

export default function OpfsSection() {
  const [steps, setSteps] = useState<Step[]>([])
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    const result = await runTests()
    setSteps(result)
    setRunning(false)
    const failed = result.filter((s) => !s.ok)
    setResult('0-2/0-3 OPFS', failed.length ? `失敗 ${failed.length}件: ${failed.map((s) => `${s.name}(${s.detail})`).join(' / ')}` : `全${result.length}項目 合格`)
    for (const s of result) if (s.detail && s.ok) setResult(`0-2 ${s.name}`, s.detail)
  }

  return (
    <section id="lab-opfs">
      <h2>0-2 保存（OPFS） / 0-3 移動（move）</h2>
      <div className="row">
        <button onClick={run} disabled={running}>{running ? '実行中…' : 'テストを実行'}</button>
      </div>
      {steps.map((s) => (
        <div key={s.name} className="log">
          <span className={s.ok ? 'ok' : 'ng'}>{s.ok ? '✔' : '✘'}</span> {s.name}
          {s.detail && <span style={{ color: 'var(--text-muted)' }}> — {s.detail}</span>}
        </div>
      ))}
    </section>
  )
}
