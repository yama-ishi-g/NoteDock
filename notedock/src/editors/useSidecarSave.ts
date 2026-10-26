import { useCallback, useEffect, useRef } from 'react'
import type { InkSidecar } from '../formats/inkSidecar'
import type { InkItem } from '../ink/items'
import type { Stroke } from '../ink/model'
import { saveSidecar } from '../services/annotations'
import { touchProject } from '../services/projects'
import { logError, useAppStore } from '../state/appStore'
import { activeEditor } from './activeEditor'

const SAVE_DELAY_MS = 1000

/** PDF・画像の書き込みを、少しまとめてから付属ファイルに保存する */
export function useSidecarSave(projectId: string, path: string) {
  const setSaveState = useAppStore((s) => s.setSaveState)
  const sidecar = useRef<InkSidecar | null>(null)
  const dirty = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const retry = useRef<() => void>(() => {})

  const save = useCallback(async () => {
    window.clearTimeout(timer.current)
    if (!dirty.current || !sidecar.current) return
    dirty.current = false
    setSaveState('saving')
    try {
      await saveSidecar(projectId, path, sidecar.current)
      setSaveState(dirty.current ? 'saving' : 'saved')
      void touchProject(projectId)
    } catch (err) {
      dirty.current = true
      setSaveState('error')
      logError(err)
      useAppStore.getState().toast(`保存できませんでした: ${err instanceof Error ? err.message : err}`, 'error')
      timer.current = window.setTimeout(() => retry.current(), 5000)
    }
  }, [projectId, path, setSaveState])

  useEffect(() => {
    retry.current = () => void save()
  }, [save])

  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && void save()
    activeEditor.flush = save
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', save)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', save)
      if (activeEditor.flush === save) activeEditor.flush = async () => {}
      void save()
    }
  }, [save])

  /** ページの線が変わったとき */
  const update = useCallback((pageIndex: string, page: { width: number; height: number }, strokes: Stroke[], items: InkItem[] = []) => {
    if (!sidecar.current) return
    sidecar.current = { ...sidecar.current, pages: { ...sidecar.current.pages, [pageIndex]: { ...page, strokes, items } } }
    dirty.current = true
    setSaveState('saving')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => retry.current(), SAVE_DELAY_MS)
  }, [setSaveState])

  /** 読み込んだ付属ファイルを保存の対象にする */
  const setLoaded = useCallback((sc: InkSidecar) => {
    sidecar.current = sc
  }, [])

  /** ページの線（手書きの層を作るときに読む） */
  const pageStrokes = useCallback((pageIndex: string): Stroke[] => sidecar.current?.pages[pageIndex]?.strokes ?? [], [])

  /** ページに置いたもの */
  const pageItems = useCallback((pageIndex: string): InkItem[] => sidecar.current?.pages[pageIndex]?.items ?? [], [])

  return { setLoaded, pageStrokes, pageItems, update }
}
