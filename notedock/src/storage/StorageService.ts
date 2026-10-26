export type DirEntry = {
  name: string
  kind: 'file' | 'dir'
  size?: number
  lastModified?: number
}

export type WriteData = Blob | ArrayBuffer | Uint8Array | string

/** 永続化層。パスは OPFS ルートからの相対パス（'/' 区切り） */
export interface StorageService {
  listDir(path: string): Promise<DirEntry[]>
  readFile(path: string): Promise<File>
  readText(path: string): Promise<string>
  readJson<T>(path: string): Promise<T>
  writeFile(path: string, data: WriteData): Promise<void>
  writeJson(path: string, data: unknown): Promise<void>
  /** 途中のフォルダも作る */
  mkdir(path: string): Promise<void>
  move(from: string, to: string): Promise<void>
  copy(from: string, to: string): Promise<void>
  /** フォルダは中身ごと削除する */
  remove(path: string): Promise<void>
  exists(path: string): Promise<boolean>
  isDir(path: string): Promise<boolean>
  estimate(): Promise<{ usage: number; quota: number }>
}

export async function toBytes(data: WriteData): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(await data.arrayBuffer())
}

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`見つかりません: ${path}`)
    this.name = 'NotFoundError'
  }
}
