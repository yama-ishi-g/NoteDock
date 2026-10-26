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
type MovableHandle = FileSystemFileHandle & { move?: (dir: FileSystemDirectoryHandle, name: string) => Promise<void> }

async function getDir(path: string): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory()
  for (const part of path.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part, { create: true })
  }
  return dir
}

async function writeTo(dir: FileSystemDirectoryHandle, name: string, data: Uint8Array) {
  const fh = await dir.getFileHandle(name, { create: true })
  const handle = await (fh as unknown as { createSyncAccessHandle(): Promise<SyncAccessHandle> }).createSyncAccessHandle()
  try {
    handle.truncate(0)
    handle.write(data, { at: 0 })
    handle.flush()
  } finally {
    handle.close()
  }
  return fh as MovableHandle
}

// 安全な上書き: name.tmp に書く → 元のファイルを削除 → name.tmp を本来の名前に移動
async function safeWrite(path: string, data: Uint8Array) {
  const i = path.lastIndexOf('/')
  const dir = await getDir(path.slice(0, Math.max(0, i)))
  const name = path.slice(i + 1)
  const tmp = await writeTo(dir, `${name}.tmp`, data)
  if (typeof tmp.move !== 'function') {
    // move() がない環境では直接上書きする
    await dir.removeEntry(`${name}.tmp`)
    await writeTo(dir, name, data)
    return
  }
  try {
    await dir.removeEntry(name)
  } catch {
    // 新規ファイル
  }
  await tmp.move(dir, name)
}

// 書き込みは届いた順に1つずつ行う（同じファイルへの書き込みが重なると失敗・消失するため）
let chain: Promise<void> = Promise.resolve()

self.onmessage = (e: MessageEvent<WriteRequest>) => {
  const { id, path, data } = e.data
  chain = chain.then(async () => {
    try {
      await safeWrite(path, new Uint8Array(data))
      postMessage({ id, ok: true })
    } catch (err) {
      postMessage({ id, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) })
    }
  })
}
