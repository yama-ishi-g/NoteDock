// OPFS への書き込み専用 Worker。
// Safari には createWritable() が使えない版があるため、Worker 内でのみ使える createSyncAccessHandle() で書き込む

type WriteRequest = { id: number; path: string; data: ArrayBuffer }

// tsconfig の lib に WebWorker を含めていないため、必要な型だけ定義する
type SyncAccessHandle = {
  truncate(size: number): void
  write(data: Uint8Array, opts: { at: number }): number
  flush(): void
  close(): void
}
async function getDir(path: string): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory()
  for (const part of path.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
  return dir
}

// 同じファイルの中身を直接書き換える。
// 以前は「name.tmp に書く → 元を削除 → 名前を変える」方式だったが、確認用のブラウザを強制終了したときに、
// その方式で書き直したファイルがフォルダから消える現象が2回起きた（段階2）。
// ファイル名の操作をしなければ、強制終了されてもフォルダの中身（どのファイルがあるか）は変わらない
async function writeFile(path: string, data: Uint8Array) {
  const i = path.lastIndexOf('/')
  const dir = await getDir(path.slice(0, Math.max(0, i)))
  const fh = await dir.getFileHandle(path.slice(i + 1), { create: true })
  const handle = await (fh as unknown as { createSyncAccessHandle(): Promise<SyncAccessHandle> }).createSyncAccessHandle()
  try {
    // 先に新しい内容を書いてから長さを合わせる（途中で終了しても、ファイルが空になることはない）
    handle.write(data, { at: 0 })
    handle.truncate(data.byteLength)
    handle.flush()
  } finally {
    handle.close()
  }
}

// 書き込みは届いた順に1つずつ行う（同じファイルへの書き込みが重なると失敗・消失するため）
let chain: Promise<void> = Promise.resolve()

self.onmessage = (e: MessageEvent<WriteRequest>) => {
  const { id, path, data } = e.data
  chain = chain.then(async () => {
    try {
      await writeFile(path, new Uint8Array(data))
      postMessage({ id, ok: true })
    } catch (err) {
      postMessage({ id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) })
    }
  })
}
