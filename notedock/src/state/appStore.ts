import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '../formats/settings'
import { saveSettings } from '../services/appData'

export type View = { screen: 'list' } | { screen: 'project'; projectId: string } | { screen: 'settings'; back: View }

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export type Toast = { id: number; message: string; kind: 'info' | 'error' }

type AppStore = {
  view: View
  /** 開いているファイル（プロジェクト内の相対パス） */
  openFile: string | null
  saveState: SaveState
  settings: Settings
  persisted: boolean | null
  /** 別のタブで同じプロジェクトを開いているため、読み取り専用 */
  readOnly: boolean
  toasts: Toast[]
  navigate: (view: View) => void
  setOpenFile: (path: string | null) => void
  setSaveState: (s: SaveState) => void
  setSettings: (s: Settings) => void
  updateSettings: (patch: Partial<Settings>) => Promise<void>
  setPersisted: (p: boolean) => void
  setReadOnly: (r: boolean) => void
  toast: (message: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
}

let toastId = 1

const LAST_VIEW_KEY = 'notedock:lastView'

function loadLastView(): { view: View; openFile: string | null } {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_VIEW_KEY) ?? 'null')
    if (saved?.view?.screen === 'project' && typeof saved.view.projectId === 'string') return { view: saved.view, openFile: saved.openFile ?? null }
  } catch {
    // 保存されていない・読めない場合は一覧から始める
  }
  return { view: { screen: 'list' }, openFile: null }
}

function saveLastView(view: View, openFile: string | null) {
  try {
    localStorage.setItem(LAST_VIEW_KEY, JSON.stringify({ view: view.screen === 'project' ? view : { screen: 'list' }, openFile }))
  } catch {
    // 保存できなくても動作に影響しない
  }
}

const initial = loadLastView()

export const useAppStore = create<AppStore>((set, get) => ({
  view: initial.view,
  openFile: initial.openFile,
  saveState: 'idle',
  settings: DEFAULT_SETTINGS,
  persisted: null,
  readOnly: false,
  toasts: [],
  navigate: (view) => {
    const openFile = view.screen === 'project' && get().view.screen === 'project' && (get().view as { projectId: string }).projectId === view.projectId ? get().openFile : view.screen === 'settings' ? get().openFile : null
    set({ view, openFile, saveState: 'idle' })
    saveLastView(view.screen === 'settings' ? view.back : view, openFile)
  },
  setOpenFile: (openFile) => {
    set({ openFile, saveState: 'idle' })
    saveLastView(get().view, openFile)
  },
  setSaveState: (saveState) => set({ saveState }),
  setSettings: (settings) => set({ settings }),
  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    await saveSettings(settings)
  },
  setPersisted: (persisted) => set({ persisted }),
  setReadOnly: (readOnly) => set({ readOnly }),
  toast: (message, kind = 'info') => {
    const id = toastId++
    set({ toasts: [...get().toasts, { id, message, kind }] })
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

/** 例外をメッセージにしてトーストで知らせる */
export function reportError(err: unknown, prefix = '') {
  const message = err instanceof Error ? err.message : String(err)
  const quota = err instanceof DOMException && err.name === 'QuotaExceededError'
  useAppStore.getState().toast(quota ? '保存できませんでした。空き容量を確認してください' : `${prefix}${message}`, 'error')
  logError(err)
}

const ERROR_LOG_KEY = 'notedock:errors'

/** 直近20件のエラーを残す（設定画面で確認できる） */
export function logError(err: unknown) {
  try {
    const list = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) ?? '[]') as { at: string; message: string }[]
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    list.unshift({ at: new Date().toISOString(), message })
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(list.slice(0, 20)))
  } catch {
    // 記録できなくても動作に影響しない
  }
}

export function readErrorLog(): { at: string; message: string }[] {
  try {
    return JSON.parse(localStorage.getItem(ERROR_LOG_KEY) ?? '[]')
  } catch {
    return []
  }
}
