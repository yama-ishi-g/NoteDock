import { useCallback, useEffect, useRef, useState } from 'react'
import { decodeText, encodeText, type TextInfo } from '../formats/text'
import { readEntry, writeEntry } from '../services/files'
import { touchProject } from '../services/projects'
import { logError, useAppStore } from '../state/appStore'
import { activeEditor } from './activeEditor'
import MarkdownPreview from './MarkdownPreview'

const SAVE_DELAY_MS = 1000

export type MdMode = 'edit' | 'preview'

/** .txt / .md のエディタ。Scribble を確実に効かせるため標準の textarea を使う */
export default function TextEditor({ projectId, path, markdown, mode }: { projectId: string; path: string; markdown: boolean; mode: MdMode }) {
  const font = useAppStore((s) => s.settings.editorFont)
  const readOnly = useAppStore((s) => s.readOnly)
  const setSaveState = useAppStore((s) => s.setSaveState)
  const [value, setValue] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const info = useRef<TextInfo | null>(null)
  const latest = useRef('')
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const retry = useRef<() => void>(() => {})

  const save = useCallback(async () => {
    window.clearTimeout(timer.current)
    if (!dirty.current || !info.current) return
    dirty.current = false
    setSaveState('saving')
    try {
      await writeEntry(projectId, path, encodeText(latest.current, info.current))
      // 保存後は UTF-8 になる
      info.current = { ...info.current, encoding: 'utf-8' }
      setSaveState(dirty.current ? 'saving' : 'saved')
      void touchProject(projectId)
    } catch (err) {
      dirty.current = true
      setSaveState('error')
      logError(err)
      const quota = err instanceof DOMException && err.name === 'QuotaExceededError'
      useAppStore.getState().toast(quota ? '保存できませんでした。空き容量を確認してください' : `保存できませんでした: ${err instanceof Error ? err.message : err}`, 'error')
      // 少し待って再試行する
      timer.current = window.setTimeout(() => retry.current(), 5000)
    }
  }, [projectId, path, setSaveState])

  useEffect(() => {
    retry.current = () => void save()
  }, [save])

  // 読み込み
  useEffect(() => {
    // ファイルごとに key を変えて作り直すため、ここでは状態を戻さない
    let cancelled = false
    readEntry(projectId, path)
      .then(async (file) => {
        const decoded = decodeText(new Uint8Array(await file.arrayBuffer()))
        if (cancelled) return
        info.current = decoded.info
        latest.current = decoded.text
        dirty.current = false
        setValue(decoded.text)
      })
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : String(err)))
    return () => {
      cancelled = true
    }
  }, [projectId, path])

  // ファイルを閉じるとき・アプリが背面に回るときは、すぐに保存する
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === 'hidden') void save()
    }
    activeEditor.flush = save
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', save)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', save)
      if (activeEditor.flush === save) activeEditor.flush = async () => {}
      void save()
    }
  }, [save])

  const onChange = (text: string) => {
    setValue(text)
    latest.current = text
    dirty.current = true
    setSaveState('saving')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void save(), SAVE_DELAY_MS)
  }

  if (loadError) return <div className="editor-message">ファイルを開けませんでした: {loadError}</div>
  if (value === null) return <div className="editor-message">読み込み中…</div>

  if (markdown && mode === 'preview') {
    return (
      <div className="editor-scroll">
        <MarkdownPreview projectId={projectId} path={path} text={value} />
      </div>
    )
  }

  return (
    <textarea
      className={`text-editor ${font === 'mono' ? 'mono' : ''}`}
      value={value}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          void save()
        }
      }}
      onBlur={() => void save()}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      aria-label={path}
    />
  )
}
