// 本番（main）と開発版（dev）の違い。開発版は本番と同じドメインで動くため、保存場所を分ける

export type Channel = 'prod' | 'dev'

export const channel: Channel = __APP_CHANNEL__ === 'dev' ? 'dev' : 'prod'
export const isDevChannel = channel === 'dev'

/** localStorage のキー（開発版は別のキーにして、本番の設定を変えない） */
export const storageKey = (name: string) => `${isDevChannel ? 'notedock-dev' : 'notedock'}:${name}`

/** 端末内の保存場所（OPFS）のルート。開発版は専用のフォルダの中に保存し、本番のノートに触れない */
export const OPFS_ROOT = isDevChannel ? 'notedock-dev' : ''
