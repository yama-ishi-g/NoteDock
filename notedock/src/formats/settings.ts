export type InkToolName = 'pen' | 'marker'

export type Settings = {
  formatVersion: 1
  lineSnapHoldMs: number
  fingerDrawDefault: boolean
  editorFont: 'sans' | 'mono'
  exportNaming: 'suffix' | 'original'
  tools: { [tool in InkToolName]: { color: string; sizeLevel: 0 | 1 | 2 } }
  eraserLevel: 0 | 1 | 2
  /** テキストボックスの文字の大きさと色 */
  textLevel: 0 | 1 | 2
  textColor: string
}

export const SETTINGS_PATH = 'settings.json'
export const APP_STATE_PATH = 'app.json'

export const DEFAULT_SETTINGS: Settings = {
  formatVersion: 1,
  lineSnapHoldMs: 600,
  fingerDrawDefault: false,
  editorFont: 'sans',
  exportNaming: 'suffix',
  tools: {
    pen: { color: '#2c2c2a', sizeLevel: 1 },
    marker: { color: '#ef9f27', sizeLevel: 1 },
  },
  eraserLevel: 1,
  textLevel: 1,
  textColor: '#2c2c2a',
}

export function migrateSettings(raw: unknown): Settings {
  const s = (raw ?? {}) as Partial<Settings>
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    formatVersion: 1,
    lineSnapHoldMs: Math.min(1500, Math.max(300, Number(s.lineSnapHoldMs ?? DEFAULT_SETTINGS.lineSnapHoldMs))),
    tools: { ...DEFAULT_SETTINGS.tools, ...s.tools },
  }
}

/** app.json: 設定ではないアプリの記録 */
export type AppState = {
  lastBackupAt?: string
  /** 使い方プロジェクトを用意したか（削除しても作り直さないため） */
  howtoSeeded?: boolean
}
