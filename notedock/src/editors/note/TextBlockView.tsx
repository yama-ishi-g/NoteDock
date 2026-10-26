import { useEffect, useLayoutEffect, useRef } from 'react'
import type { TextBlock } from '../../formats/notedock'
import { useAppStore } from '../../state/appStore'
import MarkdownPreview from '../MarkdownPreview'

type Props = {
  projectId: string
  notePath: string
  block: TextBlock
  editing: boolean
  readOnly: boolean
  onStartEdit: (id: string) => void
  onChange: (id: string, markdown: string) => void
  onEndEdit: (id: string) => void
}

/**
 * 文章のブロック。編集していないときは Markdown を整形して表示し、触れると textarea で編集する
 * （Scribble を確実に効かせるため標準の textarea を使う）
 */
export default function TextBlockView({ projectId, notePath, block, editing, readOnly, onStartEdit, onChange, onEndEdit }: Props) {
  const font = useAppStore((s) => s.settings.editorFont)
  const ref = useRef<HTMLTextAreaElement>(null)

  // 内容に合わせて高さを変える
  useLayoutEffect(() => {
    const ta = ref.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [block.markdown, editing])

  useEffect(() => {
    if (!editing) return
    const ta = ref.current!
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }, [editing])

  if (editing) {
    return (
      <div className="text-block editing">
        <textarea
          ref={ref}
          className={`text-block-input ${font === 'mono' ? 'mono' : ''}`}
          value={block.markdown}
          readOnly={readOnly}
          placeholder="文章を入力（Markdown記法が使えます）"
          onChange={(e) => onChange(block.id, e.target.value)}
          onBlur={() => onEndEdit(block.id)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
    )
  }

  return (
    <div
      className="text-block"
      onPointerDown={(e) => {
        if (readOnly || e.button !== 0) return
        // 指・ペン・マウスのどれで触れても、すぐに編集を始める（Pencil の Scribble を使えるように）
        e.preventDefault()
        onStartEdit(block.id)
      }}
    >
      {block.markdown.trim() ? (
        <MarkdownPreview projectId={projectId} path={`${notePath}/note.md`} text={block.markdown} />
      ) : (
        <p className="text-block-placeholder">タップして文章を入力</p>
      )}
    </div>
  )
}
