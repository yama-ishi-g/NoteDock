import { basename, dirname, normalizePath } from './paths'
import { NotFoundError, toBytes, type DirEntry, type StorageService, type WriteData } from './StorageService'

type MovableHandle = FileSystemHandle & { move?: (dir: FileSystemDirectoryHandle, name: string) => Promise<void> }
type IterableDir = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }

const isNotFound = (err: unknown) =>
  err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError')

/** OPFS を使った StorageService。書き込みは Worker 経由、それ以外はメインスレッドで行う */
export class OpfsStorage implements StorageService {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>()

  private getWorker() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; error?: string }>) => {
        const p = this.pending.get(e.data.id)
        if (!p) return
        this.pending.delete(e.data.id)
        if (e.data.ok) p.resolve()
        else p.reject(new Error(e.data.error))
      }
    }
    return this.worker
  }

  private async dir(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let dir = await navigator.storage.getDirectory()
    for (const part of normalizePath(path).split('/').filter(Boolean)) {
      try {
        dir = await dir.getDirectoryHandle(part, { create })
      } catch (err) {
        if (isNotFound(err)) throw new NotFoundError(path)
        throw err
      }
    }
    return dir
  }

  private async fileHandle(path: string): Promise<FileSystemFileHandle> {
    const p = normalizePath(path)
    const dir = await this.dir(dirname(p))
    try {
      return await dir.getFileHandle(basename(p))
    } catch (err) {
      if (isNotFound(err)) throw new NotFoundError(path)
      throw err
    }
  }

  async listDir(path: string): Promise<DirEntry[]> {
    const dir = (await this.dir(path)) as IterableDir
    const entries: DirEntry[] = []
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'directory') {
        entries.push({ name, kind: 'dir' })
      } else {
        const file = await (handle as FileSystemFileHandle).getFile()
        entries.push({ name, kind: 'file', size: file.size, lastModified: file.lastModified })
      }
    }
    return entries
  }

  async readFile(path: string): Promise<File> {
    return (await this.fileHandle(path)).getFile()
  }

  async readText(path: string): Promise<string> {
    return (await this.readFile(path)).text()
  }

  async readJson<T>(path: string): Promise<T> {
    return JSON.parse(await this.readText(path)) as T
  }

  async writeFile(path: string, data: WriteData): Promise<void> {
    const p = normalizePath(path)
    const bytes = await toBytes(data)
    // Transfer するためにコピーを作る（呼び出し元のバッファを壊さない）
    const buf = bytes.slice().buffer
    const id = this.nextId++
    await new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.getWorker().postMessage({ id, path: p, data: buf }, [buf])
    })
  }

  async writeJson(path: string, data: unknown): Promise<void> {
    await this.writeFile(path, JSON.stringify(data, null, 2))
  }

  async mkdir(path: string): Promise<void> {
    await this.dir(path, true)
  }

  async move(from: string, to: string): Promise<void> {
    const src = normalizePath(from)
    const dest = normalizePath(to)
    if (src === dest) return
    const destDir = await this.dir(dirname(dest), true)
    const handle = (await this.handle(src)) as MovableHandle
    if (typeof handle.move === 'function') {
      try {
        await handle.move(destDir, basename(dest))
        return
      } catch {
        // フォルダの move に対応していない環境などは、コピーして削除する
      }
    }
    await this.copy(src, dest)
    await this.remove(src)
  }

  async copy(from: string, to: string): Promise<void> {
    const src = normalizePath(from)
    const dest = normalizePath(to)
    if (await this.isDir(src)) {
      await this.mkdir(dest)
      for (const entry of await this.listDir(src)) {
        await this.copy(`${src}/${entry.name}`, `${dest}/${entry.name}`)
      }
    } else {
      await this.writeFile(dest, await this.readFile(src))
    }
  }

  async remove(path: string): Promise<void> {
    const p = normalizePath(path)
    if (!p) throw new Error('ルートは削除できません')
    const dir = await this.dir(dirname(p))
    try {
      await dir.removeEntry(basename(p), { recursive: true })
    } catch (err) {
      if (isNotFound(err)) return
      throw err
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.handle(path)
      return true
    } catch (err) {
      if (err instanceof NotFoundError) return false
      throw err
    }
  }

  async isDir(path: string): Promise<boolean> {
    try {
      return (await this.handle(path)).kind === 'directory'
    } catch (err) {
      if (err instanceof NotFoundError) return false
      throw err
    }
  }

  async estimate() {
    const e = await navigator.storage.estimate()
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
  }

  private async handle(path: string): Promise<FileSystemHandle> {
    const p = normalizePath(path)
    if (!p) return navigator.storage.getDirectory()
    const dir = await this.dir(dirname(p))
    const name = basename(p)
    try {
      return await dir.getFileHandle(name)
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
    try {
      return await dir.getDirectoryHandle(name)
    } catch (err) {
      if (isNotFound(err)) throw new NotFoundError(path)
      throw err
    }
  }
}
