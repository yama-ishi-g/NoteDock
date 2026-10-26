// opfs.worker.ts を Promise で呼び出す
let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data.result)
      else p.reject(new Error(e.data.error))
    }
  }
  return worker
}

function call<T>(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    getWorker().postMessage({ ...msg, id }, transfer)
  })
}

export const opfsWrite = (path: string, data: string | Uint8Array) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const buf = bytes.slice().buffer
  return call<void>({ op: 'write', path, data: buf }, [buf])
}
export const opfsMove = (from: string, toDir: string, toName: string) => call<void>({ op: 'move', from, toDir, toName })
export const opfsProbe = () => call<{ syncAccessHandle: boolean; move: boolean }>({ op: 'probe' })

export async function getDir(path: string, create = false): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory()
  for (const part of path.split('/').filter(Boolean)) {
    dir = await dir.getDirectoryHandle(part, { create })
  }
  return dir
}

export async function opfsReadText(path: string): Promise<string> {
  const i = path.lastIndexOf('/')
  const dir = await getDir(path.slice(0, i))
  return (await (await dir.getFileHandle(path.slice(i + 1))).getFile()).text()
}

export async function opfsExists(path: string): Promise<boolean> {
  try {
    const i = path.lastIndexOf('/')
    const dir = await getDir(path.slice(0, i))
    await dir.getFileHandle(path.slice(i + 1))
    return true
  } catch {
    return false
  }
}
