export const appVersion: string = __APP_VERSION__
export const buildCommit: string = __BUILD_COMMIT__
export const buildTime: string = __BUILD_TIME__

/** 画面表示用の版情報（例: v0.1.0（54cb01b・10/26 14:05）） */
export function formatBuildLabel(version = appVersion, commit = buildCommit, time = buildTime): string {
  const d = new Date(time)
  const pad = (n: number) => String(n).padStart(2, '0')
  const when = Number.isNaN(d.getTime()) ? '-' : `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `v${version}（${commit}・${when}）`
}
