import { APP_STATE_PATH, migrateSettings, SETTINGS_PATH, type AppState, type Settings } from '../formats/settings'
import { getStorage } from '../storage'
import { createHowToProject } from './howto'

export async function loadSettings(): Promise<Settings> {
  try {
    return migrateSettings(await getStorage().readJson(SETTINGS_PATH))
  } catch {
    return migrateSettings(undefined)
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await getStorage().writeJson(SETTINGS_PATH, settings)
}

export async function loadAppState(): Promise<AppState> {
  try {
    return await getStorage().readJson<AppState>(APP_STATE_PATH)
  } catch {
    return {}
  }
}

let howtoChecked: Promise<boolean> | null = null

/** 初めて起動したとき（v1.0.0 を初めて開いたときを含む）に、使い方プロジェクトを1回だけ用意する。作ったら true */
export function ensureHowToProject(): Promise<boolean> {
  howtoChecked ??= (async () => {
    const state = await loadAppState()
    if (state.howtoSeeded) return false
    await createHowToProject()
    await getStorage().writeJson(APP_STATE_PATH, { ...(await loadAppState()), howtoSeeded: true })
    return true
  })().finally(() => {
    // 同時に呼ばれたときに二重に作らないよう、処理中だけ共有する
    howtoChecked = null
  })
  return howtoChecked
}

export async function markBackedUp(): Promise<void> {
  const state = await loadAppState()
  await getStorage().writeJson(APP_STATE_PATH, { ...state, lastBackupAt: new Date().toISOString() })
}

/** 最後のバックアップ（書き出し）から30日以上たっているか。一度もなければ、最も古いプロジェクトの作成日から数える */
export function needsBackupReminder(lastBackupAt: string | undefined, oldestProjectCreatedAt: string | undefined, now = Date.now()): boolean {
  const base = lastBackupAt ?? oldestProjectCreatedAt
  if (!base) return false
  return now - new Date(base).getTime() >= 30 * 24 * 60 * 60 * 1000
}
