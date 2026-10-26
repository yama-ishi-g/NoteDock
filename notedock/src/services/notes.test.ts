import { beforeEach, describe, expect, it } from 'vitest'
import { projectFilesDir } from '../formats/project'
import { setStorage } from '../storage'
import { MemoryStorage } from '../storage/MemoryStorage'
import { listChildren, renameEntry } from './files'
import { cleanupNote, copyNoteFile, createHandwritingNote, createNote, importNoteZip, loadInk, loadNote, saveInk, saveNote, zipNote } from './notes'
import { createProject } from './projects'

let storage: MemoryStorage
let pid: string

beforeEach(async () => {
  storage = new MemoryStorage()
  setStorage(storage)
  pid = (await createProject('P')).id
})

const stroke = (id: string) => ({ id, tool: 'pen' as const, color: '#000000', size: 4, opacity: 1, points: [1.234567, 2, 0.51234, 3.7, 10, 20, 0.5, 20] })

describe('手書きノート', () => {
  it('作成すると手書きブロック1つのノートになり、ツリーでは1つのファイルに見える', async () => {
    const path = await createHandwritingNote(pid, '', '図')
    expect(path).toBe('図.notedock')
    const note = await loadNote(pid, path)
    expect(note.blocks).toHaveLength(1)
    expect(note.blocks[0]).toMatchObject({ type: 'ink', background: 'grid' })
    expect(await loadInk(pid, path, note.blocks[0].id)).toEqual([])
    expect((await listChildren(pid, ''))[0]).toMatchObject({ name: '図.notedock', kind: 'file', fileType: 'note' })
    expect(await createHandwritingNote(pid, '', '図.notedock')).toBe('図 (2).notedock')
  })

  it('線を保存すると数値が丸められる', async () => {
    const path = await createHandwritingNote(pid, '', '図')
    const id = (await loadNote(pid, path)).blocks[0].id
    await saveInk(pid, path, id, [stroke('a')])
    expect((await loadInk(pid, path, id))[0].points).toEqual([1.23, 2, 0.512, 4, 10, 20, 0.5, 20])
  })

  it('名前を変えても中身は保たれる', async () => {
    const path = await createHandwritingNote(pid, '', '図')
    const id = (await loadNote(pid, path)).blocks[0].id
    await saveInk(pid, path, id, [stroke('a')])
    const to = await renameEntry(pid, path, '設計図.notedock')
    expect(await loadInk(pid, to, id)).toHaveLength(1)
  })

  it('使われていない手書きファイルを掃除する', async () => {
    const path = await createHandwritingNote(pid, '', '図')
    const note = await loadNote(pid, path)
    await storage.writeFile(`${projectFilesDir(pid)}/${path}/ink/old.json`, '{}')
    await cleanupNote(pid, path, note)
    expect(await storage.exists(`${projectFilesDir(pid)}/${path}/ink/old.json`)).toBe(false)
    expect(await storage.exists(`${projectFilesDir(pid)}/${path}/ink/${note.blocks[0].id}.json`)).toBe(true)
  })

  it('.notedock ファイル（ZIP）に書き出して取り込める', async () => {
    const path = await createHandwritingNote(pid, '', '図')
    const id = (await loadNote(pid, path)).blocks[0].id
    await saveInk(pid, path, id, [stroke('a'), stroke('b')])
    const zip = await zipNote(pid, path)
    const imported = await importNoteZip(pid, '', '図.notedock', zip)
    expect(imported).toBe('図 (2).notedock')
    expect(await loadInk(pid, imported, id)).toHaveLength(2)
    await expect(importNoteZip(pid, '', 'x.notedock', new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })

  it('混在ノートは文章ブロック1つから始まる', async () => {
    const path = await createNote(pid, '', '会議', 'mixed')
    const note = await loadNote(pid, path)
    expect(note.blocks).toHaveLength(1)
    expect(note.blocks[0]).toMatchObject({ type: 'text', markdown: '' })
  })

  it('使われていない画像と、その書き込みを掃除する', async () => {
    const path = await createNote(pid, '', '会議', 'mixed')
    const base = `${projectFilesDir(pid)}/${path}`
    await storage.writeFile(`${base}/images/a.jpg`, 'A')
    await storage.writeFile(`${base}/images/a.jpg.ink.json`, '{}')
    await storage.writeFile(`${base}/images/b.jpg`, 'B')
    await storage.writeFile(`${base}/images/b.jpg.ink.json`, '{}')
    const note = await loadNote(pid, path)
    const withImage = { ...note, blocks: [...note.blocks, { id: 'a', type: 'image' as const, src: 'images/a.jpg', width: 10, height: 10 }] }
    await saveNote(pid, path, withImage)
    await cleanupNote(pid, path, withImage)
    expect(await storage.exists(`${base}/images/a.jpg`)).toBe(true)
    expect(await storage.exists(`${base}/images/a.jpg.ink.json`)).toBe(true)
    expect(await storage.exists(`${base}/images/b.jpg`)).toBe(false)
    expect(await storage.exists(`${base}/images/b.jpg.ink.json`)).toBe(false)
  })

  it('ノートの中のファイルを複製する', async () => {
    const path = await createNote(pid, '', '会議', 'mixed')
    const base = `${projectFilesDir(pid)}/${path}`
    await storage.writeFile(`${base}/images/a.jpg`, 'A')
    await copyNoteFile(pid, path, 'images/a.jpg', 'images/c.jpg')
    expect(await storage.readText(`${base}/images/c.jpg`)).toBe('A')
  })
})
