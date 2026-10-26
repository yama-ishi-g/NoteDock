import {
  ArrowLeft, Camera, Copy, FileText, FileType2, FolderInput, FolderPlus, NotebookText, Pencil, PenTool, Plus, Settings, Share, Trash2, Upload, PanelLeft,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Banner, PopupMenu, SaveIndicator, type MenuState } from '../components/common'
import FileTree from '../components/FileTree'
import ImageViewer from '../editors/ImageViewer'
import PdfViewer from '../editors/PdfViewer'
import { burnImage, burnPdf, type ExportNaming } from '../io/burn'
import { hasStrokes } from '../formats/inkSidecar'
import { loadSidecar } from '../services/annotations'
import NoteEditor from '../editors/NoteEditor'
import { createNote, withNoteExt, zipNote } from '../services/notes'
import { exportNoteMarkdown, preparePrint } from '../io/exportNote'
import { activeEditor } from '../editors/activeEditor'
import TextEditor, { type MdMode } from '../editors/TextEditor'
import { importFiles, IMPORT_ACCEPT } from '../io/importFiles'
import { dateStamp } from '../io/projectZip'
import { makeFile, shareFile } from '../io/share'
import { zipFolder } from '../io/folderZip'
import { createFile, createFolder, deleteEntry, duplicateEntry, entryExists, fileTypeOf, isNoteType, listChildren, moveEntry, readEntry, renameEntry, type TreeNode } from '../services/files'
import { getProject, recoverTempFiles, saveProject } from '../services/projects'
import { reportError, useAppStore } from '../state/appStore'
import { dialogs } from '../state/dialogs'
import { basename, dirname, extname, validateName } from '../storage/paths'
import type { ProjectMeta } from '../formats/project'
import { storageKey } from '../lib/channel'

const SIDEBAR_KEY = storageKey('sidebar')

function loadSidebar(): { width: number; visible: boolean } {
  const portrait = window.matchMedia('(orientation: portrait)').matches
  try {
    const saved = JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? 'null')
    if (saved) return { width: saved.width ?? 260, visible: portrait ? false : saved.visible ?? true }
  } catch {
    // 保存されていない
  }
  return { width: 260, visible: !portrait }
}

/** 同じプロジェクトを別のタブで開いていないかを Web Locks で確かめる */
function useProjectLock(projectId: string) {
  const setReadOnly = useAppStore((s) => s.setReadOnly)
  useEffect(() => {
    const locks = navigator.locks
    if (!locks) return
    let release: () => void = () => {}
    const held = new Promise<void>((r) => (release = r))
    let active = true
    locks.request(storageKey(`project-${projectId}`), { ifAvailable: true }, async (lock) => {
      if (!active) return
      setReadOnly(!lock)
      if (lock) await held
    })
    return () => {
      active = false
      release()
      setReadOnly(false)
    }
  }, [projectId, setReadOnly])
}

export default function ProjectView({ projectId }: { projectId: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const openFile = useAppStore((s) => s.openFile)
  const setOpenFile = useAppStore((s) => s.setOpenFile)
  const readOnly = useAppStore((s) => s.readOnly)
  const toast = useAppStore((s) => s.toast)
  const [meta, setMeta] = useState<ProjectMeta | null>(null)
  const [childrenOf, setChildrenOf] = useState<Record<string, TreeNode[] | undefined>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedDir, setSelectedDir] = useState('')
  const [menu, setMenu] = useState<MenuState>(null)
  const [sidebar, setSidebar] = useState(loadSidebar)
  const [mdMode, setMdMode] = useState<MdMode>('edit')
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const importDir = useRef('')
  const saveTreeTimer = useRef<number | undefined>(undefined)

  useProjectLock(projectId)

  const loadDir = useCallback(async (dir: string) => {
    try {
      const nodes = await listChildren(projectId, dir)
      setChildrenOf((c) => ({ ...c, [dir]: nodes }))
    } catch {
      setChildrenOf((c) => ({ ...c, [dir]: [] }))
    }
  }, [projectId])

  // 開く: 書き込み途中の .tmp を片付けてから、ツリーを読み込む
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await recoverTempFiles(projectId)
        const m = await getProject(projectId)
        if (cancelled) return
        setMeta(m)
        const exp = new Set(m.treeState?.expanded ?? [])
        setExpanded(exp)
        await Promise.all(['', ...exp].map(loadDir))
      } catch (err) {
        reportError(err, 'プロジェクトを開けませんでした: ')
        navigate({ screen: 'list' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, loadDir, navigate])

  // 開いているファイルが見つからなければ閉じる
  useEffect(() => {
    if (!openFile) return
    entryExists(projectId, openFile).then((ok) => !ok && setOpenFile(null)).catch(() => setOpenFile(null))
  }, [projectId, openFile, setOpenFile])

  const persistTree = (exp: Set<string>) => {
    window.clearTimeout(saveTreeTimer.current)
    saveTreeTimer.current = window.setTimeout(async () => {
      try {
        const m = await getProject(projectId)
        await saveProject({ ...m, treeState: { expanded: [...exp] } })
      } catch {
        // 開閉状態は保存できなくても動作に影響しない
      }
    }, 500)
  }

  const toggle = (dir: string) => {
    const next = new Set(expanded)
    if (next.has(dir)) next.delete(dir)
    else {
      next.add(dir)
      void loadDir(dir)
    }
    setExpanded(next)
    setSelectedDir(dir)
    setOpenFile(null)
    persistTree(next)
  }

  const updateSidebar = (patch: Partial<typeof sidebar>) => {
    const next = { ...sidebar, ...patch }
    setSidebar(next)
    try {
      localStorage.setItem(SIDEBAR_KEY, JSON.stringify(next))
    } catch {
      // 保存できなくても動作に影響しない
    }
  }

  const open = (node: TreeNode) => {
    setMdMode('edit')
    setOpenFile(node.path)
    setSelectedDir(dirname(node.path))
    // 縦向きでは、ファイルを開いたらツリーを閉じて編集エリアを広くする
    if (window.matchMedia('(orientation: portrait)').matches) setSidebar((s) => ({ ...s, visible: false }))
  }

  /** フォルダの中身を読み直す（開いていればそのフォルダも） */
  const refresh = async (...dirs: string[]) => {
    await Promise.all([...new Set(dirs)].map(loadDir))
  }

  // 開いているファイル（またはそれを含むフォルダ）のパスが変わったときに追従する
  const followPath = (from: string, to: string | null) => {
    if (!openFile) return
    if (openFile === from || openFile.startsWith(`${from}/`)) setOpenFile(to ? to + openFile.slice(from.length) : null)
  }

  const touchesOpenFile = (path: string) => !!openFile && (openFile === path || openFile.startsWith(`${path}/`))

  const guard = () => {
    if (readOnly) toast('別のタブで開いているため、読み取り専用です', 'error')
    return readOnly
  }

  const newFolder = async (parent: string) => {
    if (guard()) return
    const name = await dialogs.prompt({ title: '新しいフォルダ', label: 'フォルダ名', initial: '新しいフォルダ', okLabel: '作成', validate: validateName })
    if (!name) return
    try {
      const path = await createFolder(projectId, parent, name)
      const next = new Set(expanded).add(parent)
      if (parent) setExpanded(next)
      await refresh(parent)
      setSelectedDir(path)
    } catch (err) {
      reportError(err)
    }
  }

  const newFile = async (parent: string, ext: 'txt' | 'md') => {
    if (guard()) return
    const name = await dialogs.prompt({
      title: ext === 'md' ? '新しいMarkdown' : '新しいテキスト',
      label: 'ファイル名',
      initial: `新規メモ.${ext}`,
      okLabel: '作成',
      selectStem: true,
      validate: validateName,
    })
    if (!name) return
    try {
      const finalName = name.toLowerCase().endsWith(`.${ext}`) ? name : `${name}.${ext}`
      const path = await createFile(projectId, parent, finalName, '')
      if (parent && !expanded.has(parent)) {
        const next = new Set(expanded).add(parent)
        setExpanded(next)
        persistTree(next)
      }
      await refresh(parent)
      open({ name: basename(path), path, kind: 'file', fileType: fileTypeOf(path) })
    } catch (err) {
      reportError(err)
    }
  }

  const newNote = async (parent: string, kind: 'mixed' | 'handwriting') => {
    if (guard()) return
    const name = await dialogs.prompt({
      title: kind === 'mixed' ? '新しいノート' : '新しい手書きノート',
      label: 'ノートの名前',
      initial: kind === 'mixed' ? 'ノート' : '手書きノート',
      okLabel: '作成',
      validate: (v) => validateName(withNoteExt(v)),
    })
    if (!name) return
    try {
      const path = await createNote(projectId, parent, name, kind)
      if (parent && !expanded.has(parent)) {
        const next = new Set(expanded).add(parent)
        setExpanded(next)
        persistTree(next)
      }
      await refresh(parent)
      open({ name: basename(path), path, kind: 'file', fileType: fileTypeOf(path) })
    } catch (err) {
      reportError(err)
    }
  }

  const rename = async (node: TreeNode) => {
    if (guard()) return
    const input = await dialogs.prompt({ title: '名前の変更', label: '新しい名前', initial: node.name, okLabel: '変更', selectStem: node.kind === 'file', validate: validateName })
    // ノートは拡張子（.notedock / .inkdock）を外すとフォルダになってしまうため、付け直す（もう一方の拡張子への変更はできる）
    const name = input && isNoteType(node.fileType) ? withNoteExt(input, extname(node.name)) : input
    if (!name || name === node.name) return
    try {
      if (touchesOpenFile(node.path)) await activeEditor.flush()
      const to = await renameEntry(projectId, node.path, name)
      followPath(node.path, to)
      if (node.kind === 'dir' && expanded.has(node.path)) {
        const next = new Set([...expanded].map((p) => (p === node.path || p.startsWith(`${node.path}/`) ? to + p.slice(node.path.length) : p)))
        setExpanded(next)
        persistTree(next)
        await refresh(to)
      }
      await refresh(dirname(node.path))
    } catch (err) {
      reportError(err)
    }
  }

  const move = async (node: TreeNode) => {
    if (guard()) return
    const dest = await dialogs.pickFolder({ title: `「${node.name}」の移動先`, projectId, exclude: node.kind === 'dir' ? node.path : undefined })
    if (dest === null) return
    try {
      if (touchesOpenFile(node.path)) await activeEditor.flush()
      const to = await moveEntry(projectId, node.path, dest)
      followPath(node.path, to)
      await refresh(dirname(node.path), dest)
      toast(`「${dest || 'プロジェクトの最上位'}」へ移動しました`)
    } catch (err) {
      reportError(err)
    }
  }

  const duplicate = async (node: TreeNode) => {
    if (guard()) return
    try {
      if (touchesOpenFile(node.path)) await activeEditor.flush()
      await duplicateEntry(projectId, node.path)
      await refresh(dirname(node.path))
    } catch (err) {
      reportError(err)
    }
  }

  const remove = async (node: TreeNode) => {
    if (guard()) return
    const ok = await dialogs.confirm({
      title: `「${node.name}」を削除します`,
      message: node.kind === 'dir' ? 'フォルダの中のファイルもすべて削除されます。元に戻せません。' : '元に戻せません。',
      okLabel: '削除',
      danger: true,
    })
    if (!ok) return
    try {
      if (touchesOpenFile(node.path)) {
        await activeEditor.flush()
        followPath(node.path, null)
      }
      await deleteEntry(projectId, node.path)
      await refresh(dirname(node.path))
    } catch (err) {
      reportError(err)
    }
  }

  const exportEntry = async (node: TreeNode) => {
    try {
      if (touchesOpenFile(node.path)) await activeEditor.flush()
      // ノートは書き出し方を選んでもらう
      let noteFormat: 'notedock' | 'markdown' | 'pdf' = 'notedock'
      if (isNoteType(node.fileType)) {
        const choice = await dialogs.choose({
          title: 'ノートの書き出し方',
          options: [
            { value: 'notedock' as const, label: `.${extname(node.name)} ファイル（NoteDockで開ける）` },
            { value: 'markdown' as const, label: 'Markdown＋画像（ZIP）' },
            { value: 'pdf' as const, label: 'PDF（印刷画面から保存）' },
          ],
        })
        if (!choice) return
        noteFormat = choice
        if (choice === 'pdf') {
          const job = await preparePrint(projectId, node.path)
          // 印刷画面はタップの直後でないと開けないため、もう一度タップしてもらう
          const ok = await dialogs.confirm({ title: '印刷の準備ができました', message: 'iPadでは、印刷画面の共有ボタンから「PDFとして保存」や「"ファイル"に保存」を選べます。', okLabel: '印刷画面を開く' })
          if (ok) job.print()
          else job.cancel()
          return
        }
      }
      // PDF・画像に書き込みがあれば、焼き込むかどうかを選んでもらう
      let burn: ExportNaming | null = null
      if (node.fileType === 'pdf' || node.fileType === 'image') {
        const sc = await loadSidecar(projectId, node.path, node.fileType === 'pdf' ? 'pdf-page' : 'image-px')
        if (hasStrokes(sc)) {
          const naming = useAppStore.getState().settings.exportNaming
          const options = [
            { value: 'suffix' as const, label: '書き込みを焼き込む（名前に「_書き込み」を付ける）' },
            { value: 'original' as const, label: '書き込みを焼き込む（元の名前のまま）' },
          ]
          if (naming === 'original') options.reverse()
          const choice = await dialogs.choose({ title: '書き出し方', options: [...options, { value: 'raw' as const, label: '元のファイル（書き込みなし）' }] })
          if (!choice) return
          if (choice !== 'raw') {
            burn = choice
            if (choice !== naming) void useAppStore.getState().updateSettings({ exportNaming: choice })
          }
        }
      }
      const file = burn
        ? node.fileType === 'pdf'
          ? await burnPdf(projectId, node.path, burn)
          : await burnImage(projectId, node.path, burn)
        : isNoteType(node.fileType)
          ? noteFormat === 'markdown'
            ? await exportNoteMarkdown(projectId, node.path)
            : makeFile(await zipNote(projectId, node.path), node.name)
          : node.kind === 'dir'
            ? makeFile(await zipFolder(projectId, node.path), `${node.name}_${dateStamp()}.zip`)
            : makeFile(await readEntry(projectId, node.path), node.name)
      if (node.kind === 'dir' || isNoteType(node.fileType) || burn) {
        // ZIP の作成に時間がかかると共有シートを開けないため、もう一度タップしてもらう
        const ok = await dialogs.confirm({ title: '書き出しの準備ができました', message: file.name, okLabel: '共有・保存' })
        if (!ok) return
      }
      const result = await shareFile(file)
      if (result === 'downloaded') toast('ダウンロードしました')
    } catch (err) {
      reportError(err, '書き出せませんでした: ')
    }
  }

  const startImport = (dir: string, camera: boolean) => {
    if (guard()) return
    importDir.current = dir
    ;(camera ? cameraInput : fileInput).current?.click()
  }

  const onImport = async (files: FileList | null, camera: boolean) => {
    if (!files?.length) return
    const dir = importDir.current
    try {
      const result = await importFiles(projectId, dir, [...files], { fromCamera: camera })
      if (dir && !expanded.has(dir)) {
        const next = new Set(expanded).add(dir)
        setExpanded(next)
        persistTree(next)
      }
      await refresh(dir)
      if (result.imported.length) toast(`${result.imported.length}件を取り込みました`)
      for (const s of result.skipped) toast(`「${s.name}」: ${s.reason}`, 'error')
      if (result.imported.length === 1) {
        const path = result.imported[0]
        open({ name: basename(path), path, kind: 'file', fileType: fileTypeOf(path) })
      }
    } catch (err) {
      reportError(err, '取り込めませんでした: ')
    }
  }

  const createMenu = (dir: string) => [
    { label: '新しいフォルダ', icon: <FolderPlus size={16} />, onSelect: () => newFolder(dir) },
    { label: '新しいテキスト（.txt）', icon: <FileText size={16} />, onSelect: () => newFile(dir, 'txt') },
    { label: '新しいMarkdown（.md）', icon: <FileType2 size={16} />, onSelect: () => newFile(dir, 'md') },
    { label: '新しいノート（文章・手書き・画像）', icon: <NotebookText size={16} />, onSelect: () => newNote(dir, 'mixed') },
    { label: '新しい手書きノート', icon: <PenTool size={16} />, onSelect: () => newNote(dir, 'handwriting') },
    'separator' as const,
    { label: 'ファイルを取り込む', icon: <Upload size={16} />, onSelect: () => startImport(dir, false) },
    { label: 'カメラで撮る', icon: <Camera size={16} />, onSelect: () => startImport(dir, true) },
  ]

  const nodeMenu = (node: TreeNode, anchor: { x: number; y: number }) => {
    const items = [
      ...(node.kind === 'dir' ? [...createMenu(node.path), 'separator' as const] : []),
      { label: '名前の変更', icon: <Pencil size={16} />, onSelect: () => rename(node) },
      { label: '移動', icon: <FolderInput size={16} />, onSelect: () => move(node) },
      { label: '複製', icon: <Copy size={16} />, onSelect: () => duplicate(node) },
      { label: node.kind === 'dir' ? '書き出し（ZIP）' : '書き出し', icon: <Share size={16} />, onSelect: () => exportEntry(node) },
      'separator' as const,
      { label: '削除', icon: <Trash2 size={16} />, danger: true, onSelect: () => remove(node) },
    ]
    setMenu({ anchor, items })
  }

  // ツリーの幅をドラッグで変える
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = sidebar.width
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => setSidebar((s) => ({ ...s, width: Math.max(180, Math.min(520, startW + ev.clientX - startX)) }))
    const onUp = () => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      setSidebar((s) => {
        try {
          localStorage.setItem(SIDEBAR_KEY, JSON.stringify(s))
        } catch {
          // 保存できなくても動作に影響しない
        }
        return s
      })
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  const openType = openFile ? fileTypeOf(openFile) : null

  return (
    <div className="screen project-screen">
      <header className="topbar">
        <button className="icon-btn" onClick={() => { void activeEditor.flush(); navigate({ screen: 'list' }) }} aria-label="プロジェクト一覧へ"><ArrowLeft size={20} /></button>
        <button className={`icon-btn ${sidebar.visible ? 'on' : ''}`} onClick={() => updateSidebar({ visible: !sidebar.visible })} aria-label="ツリーの表示切り替え"><PanelLeft size={20} /></button>
        <h1 className="screen-title">{meta?.name ?? ''}</h1>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => navigate({ screen: 'settings', back: { screen: 'project', projectId } })} aria-label="設定"><Settings size={20} /></button>
      </header>

      {readOnly && <Banner kind="warning">このプロジェクトは別のタブで開いているため、読み取り専用で表示しています</Banner>}

      <div className="project-body">
        {sidebar.visible && (
          <aside className="sidebar" style={{ width: sidebar.width }}>
            <div className="sidebar-actions">
              <button className="btn small" onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect()
                setMenu({ anchor: { x: r.left, y: r.bottom + 4 }, items: createMenu(selectedDir) })
              }}><Plus size={16} /> 追加{selectedDir ? `（${basename(selectedDir)}）` : ''}</button>
            </div>
            <FileTree
              childrenOf={childrenOf}
              expanded={expanded}
              openFile={openFile}
              selectedDir={selectedDir}
              onToggle={toggle}
              onOpen={open}
              onMenu={nodeMenu}
            />
            <div className="tree-root-drop" onClick={() => { setSelectedDir(''); setOpenFile(null) }} />
            <div className="sidebar-resizer" onPointerDown={onResizeStart} />
          </aside>
        )}

        <section className="editor-area">
          {openFile ? (
            <>
              <div className="editor-header">
                <span className="editor-title">{basename(openFile)}</span>
                <div className="spacer" />
                {openType === 'markdown' && (
                  <span className="segmented">
                    <button className={mdMode === 'edit' ? 'on' : ''} onClick={() => setMdMode('edit')}>編集</button>
                    <button className={mdMode === 'preview' ? 'on' : ''} onClick={() => { void activeEditor.flush(); setMdMode('preview') }}>プレビュー</button>
                  </span>
                )}
                <SaveIndicator />
                <button className="icon-btn" aria-label="書き出し" onClick={() => exportEntry({ name: basename(openFile), path: openFile, kind: 'file', fileType: openType ?? 'other' })}><Share size={18} /></button>
              </div>
              <div className="editor-body">
                {(openType === 'text' || openType === 'markdown') && (
                  <TextEditor key={openFile} projectId={projectId} path={openFile} markdown={openType === 'markdown'} mode={mdMode} />
                )}
                {openType === 'image' && <ImageViewer key={openFile} projectId={projectId} path={openFile} />}
                {openType === 'pdf' && <PdfViewer key={openFile} projectId={projectId} path={openFile} />}
                {isNoteType(openType) && <NoteEditor key={openFile} projectId={projectId} path={openFile} />}
                {openType === 'other' && (
                  <div className="editor-message">
                    <p>このファイルは表示できません。</p>
                    <button className="btn" onClick={() => exportEntry({ name: basename(openFile), path: openFile, kind: 'file' })}><Share size={16} /> 書き出し</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="editor-message">
              <p>{childrenOf['']?.length === 0 ? '「追加」からファイルやフォルダを作るか、ファイルを取り込んでください' : 'ツリーからファイルを選んでください'}</p>
              {!sidebar.visible && <button className="btn" onClick={() => updateSidebar({ visible: true })}><PanelLeft size={16} /> ツリーを表示</button>}
            </div>
          )}
        </section>
      </div>

      <input ref={fileInput} type="file" multiple accept={IMPORT_ACCEPT} hidden onChange={(e) => { void onImport(e.target.files, false); e.target.value = '' }} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onImport(e.target.files, true); e.target.value = '' }} />
      {menu && <PopupMenu anchor={menu.anchor} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  )
}

