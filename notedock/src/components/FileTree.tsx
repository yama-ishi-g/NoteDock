import { ChevronDown, ChevronRight, File, FileImage, FileText, FileType2, Folder, FolderOpen, MoreHorizontal, NotebookText, PenTool } from 'lucide-react'
import type { ReactNode } from 'react'
import type { FileType, TreeNode } from '../services/files'
import { useLongPress } from './useLongPress'

const fileIcon: Record<FileType, ReactNode> = {
  text: <FileText size={16} />,
  markdown: <FileType2 size={16} />,
  pdf: <File size={16} className="icon-pdf" />,
  image: <FileImage size={16} />,
  note: <NotebookText size={16} className="icon-note" />,
  inknote: <PenTool size={16} className="icon-inknote" />,
  other: <File size={16} />,
}

export type TreeProps = {
  childrenOf: Record<string, TreeNode[] | undefined>
  expanded: Set<string>
  openFile: string | null
  selectedDir: string
  onToggle: (dir: string) => void
  onOpen: (node: TreeNode) => void
  onMenu: (node: TreeNode, anchor: { x: number; y: number }) => void
}

function Row({ node, depth, props }: { node: TreeNode; depth: number; props: TreeProps }) {
  const isDir = node.kind === 'dir'
  const open = isDir && props.expanded.has(node.path)
  const longPress = useLongPress((pos) => props.onMenu(node, pos))
  const active = isDir ? props.selectedDir === node.path && !props.openFile : props.openFile === node.path
  return (
    <>
      <div
        className={`tree-row ${active ? 'active' : ''}`}
        style={{ paddingLeft: 6 + depth * 16 }}
        {...longPress}
        onClick={() => {
          if (longPress.wasLongPress()) return
          if (isDir) props.onToggle(node.path)
          else props.onOpen(node)
        }}
        role="treeitem"
        aria-expanded={isDir ? open : undefined}
      >
        <span className="tree-chevron">{isDir ? open ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}</span>
        <span className="tree-icon">{isDir ? open ? <FolderOpen size={16} /> : <Folder size={16} /> : fileIcon[node.fileType ?? 'other']}</span>
        <span className="tree-name">{node.name}</span>
        <button
          className="icon-btn small tree-more"
          aria-label={`${node.name} のメニュー`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            props.onMenu(node, { x: r.left, y: r.bottom + 4 })
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
      {open && <Children dir={node.path} depth={depth + 1} props={props} />}
    </>
  )
}

function Children({ dir, depth, props }: { dir: string; depth: number; props: TreeProps }) {
  const nodes = props.childrenOf[dir]
  if (!nodes) return <div className="tree-loading" style={{ paddingLeft: 22 + depth * 16 }}>読み込み中…</div>
  if (!nodes.length && depth > 0) return <div className="tree-empty" style={{ paddingLeft: 22 + depth * 16 }}>（空）</div>
  return (
    <>
      {nodes.map((n) => <Row key={n.path} node={n} depth={depth} props={props} />)}
    </>
  )
}

export default function FileTree(props: TreeProps) {
  return (
    <div className="tree" role="tree">
      <Children dir="" depth={0} props={props} />
    </div>
  )
}
