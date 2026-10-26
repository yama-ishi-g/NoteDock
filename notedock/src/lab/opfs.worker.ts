// OPFS への書き込み・移動を Worker で検証する（createSyncAccessHandle は Worker 内でのみ使える）
type Req =
  | { id: number; op: 'write'; path: string; data: ArrayBuffer }
  | { id: number; op: 'move'; from: string; toDir: string; toName: string }
  | { id: number; op: 'probe' }

async function getDir(path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory()
  for (const part of path.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part, { create })
  }
  return dir
}

// tsconfig の lib に WebWorker を含めていないため、必要な型だけ定義する
type SyncAccessHandle = {
  truncate(size: number): void
  write(data: Uint8Array, opts: { at: number }): number
  flush(): void
  close(): void
}

function split(path: string): [string, string] {
  const i = path.lastIndexOf('/')
  return [path.slice(0, i), path.slice(i + 1)]
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const req = e.data
  try {
    if (req.op === 'probe') {
      const root = await navigator.storage.getDirectory()
      const fh = await root.getFileHandle('lab-probe.tmp', { create: true })
      const info = {
        syncAccessHandle: 'createSyncAccessHandle' in fh,
        move: 'move' in fh,
      }
      await root.removeEntry('lab-probe.tmp')
      postMessage({ id: req.id, ok: true, result: info })
    } else if (req.op === 'write') {
      const [dirPath, name] = split(req.path)
      const dir = await getDir(dirPath, true)
      const fh = await dir.getFileHandle(name, { create: true })
      const handle = await (fh as unknown as { createSyncAccessHandle(): Promise<SyncAccessHandle> }).createSyncAccessHandle()
      try {
        handle.truncate(0)
        handle.write(new Uint8Array(req.data), { at: 0 })
        handle.flush()
      } finally {
        handle.close()
      }
      postMessage({ id: req.id, ok: true })
    } else if (req.op === 'move') {
      const [dirPath, name] = split(req.from)
      const fh = await (await getDir(dirPath, false)).getFileHandle(name)
      const dest = await getDir(req.toDir, true)
      await (fh as unknown as { move(d: FileSystemDirectoryHandle, n: string): Promise<void> }).move(dest, req.toName)
      postMessage({ id: req.id, ok: true })
    }
  } catch (err) {
    postMessage({ id: req.id, ok: false, error: String(err) })
  }
}
