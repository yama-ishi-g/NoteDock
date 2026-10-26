import { beforeEach, describe, expect, it } from 'vitest'
import { projectFilesDir } from '../formats/project'
import { setStorage } from '../storage'
import { MemoryStorage } from '../storage/MemoryStorage'
import { listChildren, renameEntry } from './files'
import { cleanupNote, copyNoteFile, createHandwritingNote, createNote, importNoteZip, loadInk, loadInkData, loadNote, migrateNoteNames, saveInk, saveNote, syncNoteKind, withNoteExt, zipNote } from './notes'
import { createProject } from './projects'

let storage: MemoryStorage
let pid: string

beforeEach(async () => {
  storage = new MemoryStorage()
  setStorage(storage)
  pid = (await createProject('P')).id
})

const stroke = (id: string) => ({ id, tool: 'pen' as const, color: '#000000', size: 4, opacity: 1, points: [1.234567, 2, 0.51234, 3.7, 10, 20, 0.5, 20] })

describe('withNoteExt', () => {
  it('ノートの拡張子がなければ付け、どちらかが付いていればそのまま', () => {
    expect(withNoteExt('a')).toBe('a.mixdock')
    expect(withNoteExt('a', 'notedock')).toBe('a.notedock')
    expect(withNoteExt('a.notedock')).toBe('a.notedock')
    expect(withNoteExt('a.mixdock', 'notedock')).toBe('a.mixdock')
  })
})

describe('手書きノート', () => {
  it('作成すると手書きブロック1つのノートになり、ツリーでは1つのファイルに見える', async () => {
    const path = await createHandwritingNote(pid, '', '図')
    expect(path).toBe('図.notedock')
    expect((await loadNote(pid, path)).kind).toBe('handwriting')
    const note = await loadNote(pid, path)
    expect(note.blocks).toHaveLength(1)
    expect(note.blocks[0]).toMatchObject({ type: 'ink', background: 'grid' })
    expect(await loadInk(pid, path, note.blocks[0].id)).toEqual([])
    expect((await listChildren(pid, ''))[0]).toMatchObject({ name: '図.notedock', kind: 'file', fileType: 'inknote' })
    expect(await createHandwritingNote(pid, '', '図.notedock')).toBe('図 (2).notedock')
    // 混在ノートは .mixdock
    expect(await createNote(pid, '', '図', 'mixed')).toBe('図.mixdock')
    expect((await loadNote(pid, '図.mixdock')).kind).toBe('mixed')
    expect((await listChildren(pid, '')).map((n) => n.fileType)).toEqual(['inknote', 'note', 'inknote'])
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

  it('ノートのファイル（ZIP）に書き出して取り込める', async () => {
    const path = await createHandwritingNote(pid, '', '図')
    const id = (await loadNote(pid, path)).blocks[0].id
    await saveInk(pid, path, id, [stroke('a'), stroke('b')])
    const zip = await zipNote(pid, path)
    const imported = await importNoteZip(pid, '', '図.notedock', zip)
    expect(imported).toBe('図 (2).notedock')
    expect(await loadInk(pid, imported, id)).toHaveLength(2)
    await expect(importNoteZip(pid, '', 'x.notedock', new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })

  it('以前の拡張子のノートを今の拡張子にそろえる', async () => {
    const base = projectFilesDir(pid)
    const legacy = (blocks: unknown[]) => JSON.stringify({ formatVersion: 1, id: 'x', createdAt: '', updatedAt: '', blocks })
    const ink = { id: 'i', type: 'ink', height: 500, background: 'grid' }
    const text = { id: 't', type: 'text', markdown: 'a' }
    // v1.0.0 の混在ノート（.notedock、kind なし）
    await storage.writeFile(`${base}/会議.notedock/note.json`, legacy([text, ink]))
    // v1.0.0 の手書きノート（.notedock、手書きブロック1つ、kind なし）
    await storage.writeFile(`${base}/sub/図.notedock/note.json`, legacy([ink]))
    // 以前の開発版の手書きノート
    await storage.writeFile(`${base}/メモ.inkdock/note.json`, legacy([ink]))
    // 今の形式（手書きノートとして作り、文章を足したもの）は変えない
    await storage.writeFile(`${base}/新.notedock/note.json`, JSON.stringify({ ...JSON.parse(legacy([ink, text])), kind: 'handwriting' }))
    const renamed = await migrateNoteNames(pid)
    expect(renamed.sort()).toEqual([['メモ.inkdock', 'メモ.notedock'], ['会議.notedock', '会議.mixdock']])
    expect((await loadNote(pid, '会議.mixdock')).kind).toBe('mixed')
    expect((await loadNote(pid, 'sub/図.notedock')).kind).toBe('handwriting')
    expect((await loadNote(pid, 'メモ.notedock')).kind).toBe('handwriting')
    expect((await loadNote(pid, '新.notedock')).kind).toBe('handwriting')
    // 2回目は何もしない
    expect(await migrateNoteNames(pid)).toEqual([])
  })

  it('以前の形式のノートを取り込むと、今の拡張子にそろえる', async () => {
    const path = await createNote(pid, '', '会議', 'mixed')
    const zip = await zipNote(pid, path)
    // kind のない v1.0.0 の混在ノート .notedock として取り込む
    const { unzipSync, zipSync, strToU8 } = await import('fflate')
    const files = unzipSync(zip)
    const meta = JSON.parse(new TextDecoder().decode(files['note.json']))
    delete meta.kind
    files['note.json'] = strToU8(JSON.stringify(meta))
    expect(await importNoteZip(pid, '', '古い.notedock', zipSync(files))).toBe('古い.mixdock')
    expect((await loadNote(pid, '古い.mixdock')).kind).toBe('mixed')
  })

  it('拡張子を付け替えたら種類も合わせる', async () => {
    const path = await createNote(pid, '', '会議', 'mixed')
    const to = await renameEntry(pid, path, '会議.notedock')
    await syncNoteKind(pid, to)
    expect((await loadNote(pid, to)).kind).toBe('handwriting')
    expect(await migrateNoteNames(pid)).toEqual([])
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

  it('手書きブロック・画像ブロックに置いた画像は掃除しない', async () => {
    const path = await createNote(pid, '', '会議', 'mixed')
    const base = `${projectFilesDir(pid)}/${path}`
    await storage.writeFile(`${base}/images/a.jpg`, 'A')
    await storage.writeFile(`${base}/images/a.jpg.ink.assets/x.png`, 'X')
    await storage.writeFile(`${base}/images/b.jpg.ink.assets/y.png`, 'Y')
    await storage.writeFile(`${base}/images/placed.png`, 'P')
    const note = await loadNote(pid, path)
    const next = {
      ...note,
      blocks: [...note.blocks, { id: 'ink1', type: 'ink' as const, height: 300, background: 'plain' as const }, { id: 'a', type: 'image' as const, src: 'images/a.jpg', width: 10, height: 10 }],
    }
    await saveNote(pid, path, next)
    await saveInk(pid, path, 'ink1', [], [{ id: 'i', type: 'image', src: 'images/placed.png', x: 0, y: 0, w: 10, h: 10 }])
    expect((await loadInkData(pid, path, 'ink1')).items).toHaveLength(1)
    await cleanupNote(pid, path, next)
    expect(await storage.exists(`${base}/images/placed.png`)).toBe(true)
    expect(await storage.exists(`${base}/images/a.jpg.ink.assets/x.png`)).toBe(true)
    expect(await storage.exists(`${base}/images/b.jpg.ink.assets`)).toBe(false)
  })

  it('ノートの中のファイルを複製する', async () => {
    const path = await createNote(pid, '', '会議', 'mixed')
    const base = `${projectFilesDir(pid)}/${path}`
    await storage.writeFile(`${base}/images/a.jpg`, 'A')
    await copyNoteFile(pid, path, 'images/a.jpg', 'images/c.jpg')
    expect(await storage.readText(`${base}/images/c.jpg`)).toBe('A')
  })
})
