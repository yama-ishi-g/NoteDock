import { basename, dirname, normalizePath } from './paths'
import { NotFoundError, toBytes, type DirEntry, type StorageService, type WriteData } from './StorageService'

/** テスト用のメモリ上の StorageService */
export class MemoryStorage implements StorageService {
  private files = new Map<string, { data: Uint8Array; lastModified: number }>()
  private dirs = new Set<string>([''])

  async listDir(path: string): Promise<DirEntry[]> {
    const p = normalizePath(path)
    if (!this.dirs.has(p)) throw new NotFoundError(path)
    const prefix = p ? `${p}/` : ''
    const entries: DirEntry[] = []
    for (const d of this.dirs) {
      if (d && d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) entries.push({ name: d.slice(prefix.length), kind: 'dir' })
    }
    for (const [f, v] of this.files) {
      if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) {
        entries.push({ name: f.slice(prefix.length), kind: 'file', size: v.data.length, lastModified: v.lastModified })
      }
    }
    return entries
  }

  async readFile(path: string): Promise<File> {
    const p = normalizePath(path)
    const f = this.files.get(p)
    if (!f) throw new NotFoundError(path)
    return new File([f.data as BlobPart], basename(p), { lastModified: f.lastModified })
  }

  async readText(path: string): Promise<string> {
    const f = this.files.get(normalizePath(path))
    if (!f) throw new NotFoundError(path)
    return new TextDecoder().decode(f.data)
  }

  async readJson<T>(path: string): Promise<T> {
    return JSON.parse(await this.readText(path)) as T
  }

  async writeFile(path: string, data: WriteData): Promise<void> {
    const p = normalizePath(path)
    if (this.dirs.has(p)) throw new Error(`フォルダがあります: ${path}`)
    await this.mkdir(dirname(p))
    this.files.set(p, { data: (await toBytes(data)).slice(), lastModified: Date.now() })
  }

  async writeJson(path: string, data: unknown): Promise<void> {
    await this.writeFile(path, JSON.stringify(data, null, 2))
  }

  async mkdir(path: string): Promise<void> {
    const parts = normalizePath(path).split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) this.dirs.add(parts.slice(0, i).join('/'))
  }

  async move(from: string, to: string): Promise<void> {
    const src = normalizePath(from)
    const dest = normalizePath(to)
    if (src === dest) return
    await this.copy(src, dest)
    await this.remove(src)
  }

  async copy(from: string, to: string): Promise<void> {
    const src = normalizePath(from)
    const dest = normalizePath(to)
    if (this.files.has(src)) {
      await this.mkdir(dirname(dest))
      this.files.set(dest, { ...this.files.get(src)! })
      return
    }
    if (!this.dirs.has(src)) throw new NotFoundError(from)
    for (const d of [...this.dirs]) if (d === src || d.startsWith(`${src}/`)) this.dirs.add(dest + d.slice(src.length))
    await this.mkdir(dirname(dest))
    for (const [f, v] of [...this.files]) if (f.startsWith(`${src}/`)) this.files.set(dest + f.slice(src.length), { ...v })
  }

  async remove(path: string): Promise<void> {
    const p = normalizePath(path)
    if (!p) throw new Error('ルートは削除できません')
    this.files.delete(p)
    for (const d of [...this.dirs]) if (d === p || d.startsWith(`${p}/`)) this.dirs.delete(d)
    for (const f of [...this.files.keys()]) if (f.startsWith(`${p}/`)) this.files.delete(f)
  }

  async exists(path: string): Promise<boolean> {
    const p = normalizePath(path)
    return this.files.has(p) || this.dirs.has(p)
  }

  async isDir(path: string): Promise<boolean> {
    return this.dirs.has(normalizePath(path))
  }

  async estimate() {
    let usage = 0
    for (const f of this.files.values()) usage += f.data.length
    return { usage, quota: 1024 * 1024 * 1024 }
  }
}
