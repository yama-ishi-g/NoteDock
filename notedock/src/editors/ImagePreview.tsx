import { useEffect, useState } from 'react'
import { readEntry } from '../services/files'

/** 画像の表示のみ（書き込みは段階3の画像ビューアで対応する） */
export default function ImagePreview({ projectId, path }: { projectId: string; path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    readEntry(projectId, path)
      .then((file) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(file)
        setUrl(objectUrl)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [projectId, path])

  if (error) return <div className="editor-message">画像を開けませんでした: {error}</div>
  if (!url) return <div className="editor-message">読み込み中…</div>
  return (
    <div className="image-preview">
      <img src={url} alt={path} />
    </div>
  )
}
