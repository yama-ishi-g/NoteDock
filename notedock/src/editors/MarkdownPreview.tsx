import { useEffect, useMemo, useRef } from 'react'
import { renderMarkdown } from '../lib/markdown'
import { readEntry } from '../services/files'
import { dirname, joinPath, normalizePath } from '../storage/paths'

const isExternal = (url: string) => /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')

export default function MarkdownPreview({ projectId, path, text }: { projectId: string; path: string; text: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdown(text), [text])

  useEffect(() => {
    const root = ref.current!
    // 外部リンクは新しいタブで開く
    for (const a of root.querySelectorAll('a[href]')) {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    }
    // プロジェクト内の相対パスの画像は、端末内のファイルを読んで表示する
    const urls: string[] = []
    let cancelled = false
    for (const img of root.querySelectorAll<HTMLImageElement>('img[src]')) {
      const src = img.getAttribute('src')!
      if (isExternal(src) || src.startsWith('data:')) continue
      img.removeAttribute('src')
      let rel: string
      try {
        rel = normalizePath(joinPath(dirname(path), decodeURIComponent(src)))
      } catch {
        continue
      }
      readEntry(projectId, rel)
        .then((file) => {
          if (cancelled) return
          const url = URL.createObjectURL(file)
          urls.push(url)
          img.src = url
        })
        .catch(() => img.setAttribute('alt', `${img.alt}（画像が見つかりません: ${src}）`))
    }
    return () => {
      cancelled = true
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [html, projectId, path])

  return <div ref={ref} className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
}
