import { ChevronDown, ChevronRight, Folder, FolderRoot } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { listChildren, type TreeNode } from '../services/files'
import { useDialogStore, type FolderPickOptions, type PromptOptions } from '../state/dialogs'

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="modal-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function PromptDialog({ opts, resolve }: { opts: PromptOptions; resolve: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.initial ?? '')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current!
    input.focus()
    // 名前の変更では、拡張子を除いた部分を選択する
    const dot = opts.selectStem ? input.value.lastIndexOf('.') : -1
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length)
  }, [opts.selectStem])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    const err = opts.validate?.(v) ?? (v ? null : '入力してください')
    if (err) {
      setError(err)
      return
    }
    resolve(v)
  }

  return (
    <Modal title={opts.title} onClose={() => resolve(null)}>
      <form onSubmit={submit}>
        {opts.label && <label className="field-label">{opts.label}</label>}
        <input
          ref={inputRef}
          className="text-input"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setError(null)
          }}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {error && <p className="field-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => resolve(null)}>キャンセル</button>
          <button type="submit" className="btn btn-primary">{opts.okLabel ?? 'OK'}</button>
        </div>
      </form>
    </Modal>
  )
}

function FolderRow({ projectId, node, depth, exclude, selected, onSelect }: {
  projectId: string
  node: TreeNode
  depth: number
  exclude?: string
  selected: string
  onSelect: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [children, setChildren] = useState<TreeNode[] | null>(null)
  useEffect(() => {
    if (open && !children) listChildren(projectId, node.path).then((c) => setChildren(c.filter((n) => n.kind === 'dir')))
  }, [open, children, projectId, node.path])
  if (exclude && (node.path === exclude || node.path.startsWith(`${exclude}/`))) return null
  return (
    <>
      <div className={`folder-row ${selected === node.path ? 'selected' : ''}`} style={{ paddingLeft: 8 + depth * 18 }} onClick={() => onSelect(node.path)}>
        <button className="icon-btn small" onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }} aria-label={open ? '閉じる' : '開く'}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <Folder size={16} />
        <span>{node.name}</span>
      </div>
      {open && children?.map((c) => <FolderRow key={c.path} projectId={projectId} node={c} depth={depth + 1} exclude={exclude} selected={selected} onSelect={onSelect} />)}
    </>
  )
}

function FolderDialog({ opts, resolve }: { opts: FolderPickOptions; resolve: (v: string | null) => void }) {
  const [roots, setRoots] = useState<TreeNode[]>([])
  const [selected, setSelected] = useState('')
  useEffect(() => {
    listChildren(opts.projectId, '').then((c) => setRoots(c.filter((n) => n.kind === 'dir')))
  }, [opts.projectId])
  return (
    <Modal title={opts.title} onClose={() => resolve(null)}>
      <div className="folder-list">
        <div className={`folder-row ${selected === '' ? 'selected' : ''}`} onClick={() => setSelected('')}>
          <FolderRoot size={16} />
          <span>（プロジェクトの最上位）</span>
        </div>
        {roots.map((n) => <FolderRow key={n.path} projectId={opts.projectId} node={n} depth={0} exclude={opts.exclude} selected={selected} onSelect={setSelected} />)}
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={() => resolve(null)}>キャンセル</button>
        <button className="btn btn-primary" onClick={() => resolve(selected)}>ここに移動</button>
      </div>
    </Modal>
  )
}

export default function Dialogs() {
  const current = useDialogStore((s) => s.current)
  if (!current) return null
  switch (current.kind) {
    case 'confirm':
      return (
        <Modal title={current.opts.title} onClose={() => current.resolve(false)}>
          {current.opts.message && <p className="modal-message">{current.opts.message}</p>}
          <div className="modal-actions">
            <button className="btn" onClick={() => current.resolve(false)}>キャンセル</button>
            <button className={`btn ${current.opts.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => current.resolve(true)} autoFocus>
              {current.opts.okLabel ?? 'OK'}
            </button>
          </div>
        </Modal>
      )
    case 'prompt':
      return <PromptDialog opts={current.opts} resolve={current.resolve} />
    case 'choose':
      return (
        <Modal title={current.opts.title} onClose={() => current.resolve(null)}>
          {current.opts.message && <p className="modal-message">{current.opts.message}</p>}
          <div className="modal-actions vertical">
            {current.opts.options.map((o) => (
              <button key={o.value} className={`btn ${o.danger ? 'btn-danger' : ''}`} onClick={() => current.resolve(o.value)}>{o.label}</button>
            ))}
            <button className="btn" onClick={() => current.resolve(null)}>キャンセル</button>
          </div>
        </Modal>
      )
    case 'folder':
      return <FolderDialog opts={current.opts} resolve={current.resolve} />
  }
}
