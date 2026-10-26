import { useCallback, useRef, useState } from 'react'
import type { InkEngine } from './InkEngine'
import type { InkItem } from './items'
import type { ItemsLayerHandle } from './ItemsLayer'

/** 手書き面（InkEngine）と、置いたものの表示（ItemsLayer / ItemsOverlay）をつなぐ */
export function useInkItems(engineRef: React.RefObject<InkEngine | null>) {
  const [items, setItems] = useState<InkItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const layerRef = useRef<ItemsLayerHandle>(null)

  const onItems = useCallback((next: InkItem[], selected: string | null) => {
    setItems(next)
    setSelectedId(selected)
  }, [])

  const hitTestItem = useCallback((x: number, y: number) => layerRef.current?.hitTest(x, y) ?? null, [])

  const onEditText = useCallback((id: string) => {
    engineRef.current?.beginTextEdit(id)
    setEditingId(id)
  }, [engineRef])

  const onEndEdit = useCallback(() => setEditingId(null), [])

  return { items, selectedId, editingId, setEditingId, layerRef, engineOptions: { onItems, hitTestItem, onEditText, onEndEdit } }
}
