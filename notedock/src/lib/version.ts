import { isDevChannel } from './channel'

export const appVersion: string = __APP_VERSION__
/** 不具合の調査用（検証レポートに含める）。画面の版表示には出さない */
export const buildCommit: string = __BUILD_COMMIT__
export const buildTime: string = __BUILD_TIME__

/** 画面表示用の版情報（例: v1.0.0（10/26 17:24））。日時で新しい版に更新されたかを確かめられる */
export function formatBuildLabel(version = appVersion, time = buildTime, dev = isDevChannel): string {
  const d = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  const when = Number.isNaN(d.getTime()) ? '-' : `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `v${version}${dev ? ' 開発版' : ''}（${when}）`
}
