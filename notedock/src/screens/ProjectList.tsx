import { Download, Folder, MoreHorizontal, Pencil, Plus, Settings, Share, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Banner, PopupMenu, type MenuState } from '../components/common'
import { importZipFile } from '../io/importZipFile'
import { exportProjectZip } from '../io/projectZip'
import { shareFile } from '../io/share'
import { loadAppState, markBackedUp, needsBackupReminder } from '../services/appData'
import { countFiles, createProject, deleteProject, listProjects, renameProject } from '../services/projects'
import { reportError, useAppStore } from '../state/appStore'
import { dialogs } from '../state/dialogs'
import { validateName } from '../storage/paths'
import type { ProjectMeta } from '../formats/project'

const dateFmt = new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function formatUpdated(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return `今日 ${d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`
  return dateFmt.format(d)
}

export default function ProjectList() {
  const navigate = useAppStore((s) => s.navigate)
  const toast = useAppStore((s) => s.toast)
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [menu, setMenu] = useState<MenuState>(null)
  const [backupReminder, setBackupReminder] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    try {
      const list = await listProjects()
      setProjects(list)
      const state = await loadAppState()
      const oldest = list.map((p) => p.createdAt).sort()[0]
      setBackupReminder(needsBackupReminder(state.lastBackupAt, oldest))
      for (const p of list) countFiles(p.id).then((n) => setCounts((c) => ({ ...c, [p.id]: n })))
    } catch (err) {
      reportError(err, 'プロジェクトを読み込めませんでした: ')
      setProjects([])
    }
  }, [])

  useEffect(() => {
    // 端末内のデータ（外部の状態）を読み込んで一覧に反映する
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
  }, [reload])

  const create = async () => {
    const name = await dialogs.prompt({ title: '新しいプロジェクト', label: 'プロジェクト名', okLabel: '作成', validate: validateName })
    if (!name) return
    try {
      const meta = await createProject(name)
      navigate({ screen: 'project', projectId: meta.id })
    } catch (err) {
      reportError(err)
    }
  }

  const rename = async (p: ProjectMeta) => {
    const name = await dialogs.prompt({ title: '名前の変更', label: 'プロジェクト名', initial: p.name, okLabel: '変更', validate: validateName })
    if (!name || name === p.name) return
    try {
      await renameProject(p.id, name)
      await reload()
    } catch (err) {
      reportError(err)
    }
  }

  const remove = async (p: ProjectMeta) => {
    const ok = await dialogs.confirm({ title: `「${p.name}」を削除します`, message: 'プロジェクトの中のファイルもすべて削除されます。元に戻せません。', okLabel: '削除', danger: true })
    if (!ok) return
    try {
      await deleteProject(p.id)
      await reload()
    } catch (err) {
      reportError(err)
    }
  }

  const exportZip = async (p: ProjectMeta) => {
    try {
      const file = await exportProjectZip(p.id)
      // ZIP の作成に時間がかかると共有シートを開けないため、もう一度タップしてもらう
      const ok = await dialogs.confirm({ title: '書き出しの準備ができました', message: `${file.name}（${(file.size / 1024 / 1024).toFixed(1)} MB）`, okLabel: '共有・保存' })
      if (!ok) return
      const result = await shareFile(file)
      if (result !== 'cancelled') {
        await markBackedUp()
        setBackupReminder(false)
        toast(result === 'downloaded' ? 'ダウンロードしました' : '書き出しました')
      }
    } catch (err) {
      reportError(err, '書き出せませんでした: ')
    }
  }

  const onImport = async (file: File | undefined) => {
    if (!file) return
    try {
      await importZipFile(file)
      await reload()
    } catch (err) {
      reportError(err, '読み込めませんでした: ')
    }
  }

  const openMenu = (p: ProjectMeta, anchor: { x: number; y: number }) =>
    setMenu({
      anchor,
      items: [
        { label: '名前の変更', icon: <Pencil size={16} />, onSelect: () => rename(p) },
        { label: '書き出し（ZIP）', icon: <Share size={16} />, onSelect: () => exportZip(p) },
        'separator',
        { label: '削除', icon: <Trash2 size={16} />, danger: true, onSelect: () => remove(p) },
      ],
    })

  return (
    <div className="screen">
      <header className="topbar">
        <h1 className="app-title">NoteDock</h1>
        <div className="spacer" />
        <button className="btn" onClick={create}><Plus size={16} /> 新規</button>
        <button className="btn" onClick={() => fileInput.current?.click()}><Upload size={16} /> 読み込み</button>
        <button className="icon-btn" onClick={() => navigate({ screen: 'settings', back: { screen: 'list' } })} aria-label="設定"><Settings size={20} /></button>
        <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={(e) => { void onImport(e.target.files?.[0]); e.target.value = '' }} />
      </header>

      {backupReminder && (
        <Banner kind="warning" onClose={() => setBackupReminder(false)}>
          最後の書き出しから30日以上たっています。プロジェクトの「…」→「書き出し」でバックアップしてください
        </Banner>
      )}

      <main className="project-grid">
        {projects?.map((p) => (
          <div key={p.id} className="project-card" onClick={() => navigate({ screen: 'project', projectId: p.id })}
            onContextMenu={(e) => { e.preventDefault(); openMenu(p, { x: e.clientX, y: e.clientY }) }}>
            <div className="project-card-head">
              <Folder size={22} className="accent" />
              <button className="icon-btn small" aria-label="メニュー" onClick={(e) => {
                e.stopPropagation()
                const r = e.currentTarget.getBoundingClientRect()
                openMenu(p, { x: r.left, y: r.bottom + 4 })
              }}><MoreHorizontal size={18} /></button>
            </div>
            <div className="project-card-name">{p.name}</div>
            <div className="muted">{counts[p.id] === undefined ? ' ' : `${counts[p.id]} ファイル`}</div>
            <div className="muted small">{formatUpdated(p.updatedAt)}</div>
          </div>
        ))}
        {projects && (
          <button className="project-card new" onClick={create}>
            <Plus size={22} />
            <span>新しいプロジェクト</span>
          </button>
        )}
      </main>

      {projects?.length === 0 && (
        <p className="empty-hint">
          <Download size={16} /> Windowsなどで書き出したZIPは、右上の「読み込み」から取り込めます
        </p>
      )}

      {menu && <PopupMenu anchor={menu.anchor} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}
