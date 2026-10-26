import { memo, useEffect, useRef, useState } from 'react'
import type { InkSidecar } from '../../formats/inkSidecar'
import type { ImageBlock } from '../../formats/notedock'
import type { InkEngine } from '../../ink/InkEngine'
import type { Stroke, Tool } from '../../ink/model'
import { loadSidecar } from '../../services/annotations'
import { readNoteFile } from '../../services/notes'
import PageInk from '../PageInk'

type Props = {
  projectId: string
  notePath: string
  block: ImageBlock
  width: number
  tool: Tool
  penColor: string
  finger: boolean
  holdMs: number
  readOnly: boolean
  scroller: HTMLElement | null
  onEngine: (key: string, engine: InkEngine | null) => void
  onHistory: (key: string, canUndo: boolean, canRedo: boolean) => void
  onInkChange: (block: ImageBlock, sidecar: InkSidecar) => void
}

/** 画像のブロック。画像の上に書き込める（座標は画像のピクセル。付属ファイルは images/xxx.jpg.ink.json） */
function ImageBlockView({ projectId, notePath, block, width, tool, penColor, finger, holdMs, readOnly, scroller, onEngine, onHistory, onInkChange }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sidecar = useRef<InkSidecar | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    ;(async () => {
      try {
        const file = await readNoteFile(projectId, notePath, block.src)
        const sc = await loadSidecar(projectId, `${notePath}/${block.src}`, 'image-px')
        if (cancelled) return
        sidecar.current = sc
        objectUrl = URL.createObjectURL(file)
        setUrl(objectUrl)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [projectId, notePath, block.src])

  const height = Math.round((width * block.height) / block.width)
  if (error) return <div className="block-placeholder">画像を表示できません: {error}</div>

  return (
    <div className="image-block" style={{ width, height }}>
      {url && (
        <>
          <img src={url} alt={block.caption ?? ''} draggable={false} />
          <PageInk
            pageKey={block.id}
            width={width}
            height={height}
            logicalWidth={block.width}
            getStrokes={() => sidecar.current?.pages['0']?.strokes ?? []}
            tool={tool}
            penColor={penColor}
            finger={finger}
            holdMs={holdMs}
            readOnly={readOnly}
            scroller={scroller}
            onEngine={onEngine}
            onHistory={onHistory}
            touchPan
            onChange={(_key: string, strokes: Stroke[]) => {
              if (!sidecar.current) return
              sidecar.current = { ...sidecar.current, pages: { '0': { width: block.width, height: block.height, strokes } } }
              onInkChange(block, sidecar.current)
            }}
          />
        </>
      )}
    </div>
  )
}

export default memo(ImageBlockView)
