import { beforeEach, describe, expect, it } from 'vitest'
import { projectFilesDir } from '../formats/project'
import { setStorage } from '../storage'
import { MemoryStorage } from '../storage/MemoryStorage'
import { createFile, createFolder, deleteEntry, duplicateEntry, listChildren, moveEntry, renameEntry } from './files'
import { createProject, deleteProject, listProjects, recoverTempFiles, renameProject } from './projects'

let storage: MemoryStorage
let pid: string

beforeEach(async () => {
  storage = new MemoryStorage()
  setStorage(storage)
  pid = (await createProject('テスト')).id
})

const p = (rel: string) => `${projectFilesDir(pid)}/${rel}`

describe('projects', () => {
  it('作成・一覧・名前変更・削除', async () => {
    await createProject('二つ目')
    expect((await listProjects()).map((x) => x.name).sort()).toEqual(['テスト', '二つ目'])
    await expect(createProject('テスト')).rejects.toThrow('同じ名前')
    await expect(createProject('a/b')).rejects.toThrow()
    await renameProject(pid, '改名')
    expect((await listProjects()).some((x) => x.name === '改名')).toBe(true)
    await deleteProject(pid)
    expect((await listProjects()).map((x) => x.name)).toEqual(['二つ目'])
  })

  it('書き込み途中の .tmp を片付ける', async () => {
    await storage.writeFile(p('a.txt'), 'old')
    await storage.writeFile(p('a.txt.tmp'), 'new')
    await storage.writeFile(p('b.txt.tmp'), 'only-tmp')
    expect(await recoverTempFiles(pid)).toBe(2)
    expect(await storage.readText(p('a.txt'))).toBe('old')
    expect(await storage.readText(p('b.txt'))).toBe('only-tmp')
    expect(await storage.exists(p('a.txt.tmp'))).toBe(false)
  })
})

describe('files', () => {
  it('一覧はフォルダが先・名前順で、付属ファイルと .tmp を出さない', async () => {
    await createFile(pid, '', 'b.txt')
    await createFile(pid, '', 'a.pdf')
    await storage.writeFile(p('a.pdf.ink.json'), '{}')
    await storage.writeFile(p('x.tmp'), '')
    await createFolder(pid, '', '資料')
    await storage.mkdir(p('図.notedock'))
    const nodes = await listChildren(pid, '')
    expect(nodes.map((n) => n.name)).toEqual(['資料', 'a.pdf', 'b.txt', '図.notedock'])
    expect(nodes.find((n) => n.name === '図.notedock')).toMatchObject({ kind: 'file', fileType: 'note' })
  })

  it('同じ名前で作ると (2) になる', async () => {
    expect(await createFile(pid, '', 'メモ.txt')).toBe('メモ.txt')
    expect(await createFile(pid, '', 'メモ.txt')).toBe('メモ (2).txt')
    expect(await createFolder(pid, '', 'f')).toBe('f')
    expect(await createFolder(pid, '', 'f')).toBe('f (2)')
  })

  it('名前の変更は付属ファイルも一緒に変え、重複はエラーにする', async () => {
    await createFile(pid, '', 'a.pdf', 'pdf')
    await storage.writeFile(p('a.pdf.ink.json'), '{"s":1}')
    await createFile(pid, '', 'b.pdf')
    expect(await renameEntry(pid, 'a.pdf', 'c.pdf')).toBe('c.pdf')
    expect(await storage.readText(p('c.pdf.ink.json'))).toBe('{"s":1}')
    expect(await storage.exists(p('a.pdf.ink.json'))).toBe(false)
    await expect(renameEntry(pid, 'c.pdf', 'b.pdf')).rejects.toThrow('同じ名前')
  })

  it('移動・複製・削除', async () => {
    await createFolder(pid, '', 'dest')
    await createFile(pid, '', 'x.jpg', 'img')
    await storage.writeFile(p('x.jpg.ink.json'), '{}')
    await createFile(pid, 'dest', 'x.jpg')
    // 移動先に同じ名前があれば (2)
    expect(await moveEntry(pid, 'x.jpg', 'dest')).toBe('dest/x (2).jpg')
    expect(await storage.exists(p('dest/x (2).jpg.ink.json'))).toBe(true)
    await expect(moveEntry(pid, 'dest', 'dest')).rejects.toThrow()
    expect(await duplicateEntry(pid, 'dest/x (2).jpg')).toBe('dest/x (3).jpg')
    expect(await storage.exists(p('dest/x (3).jpg.ink.json'))).toBe(true)
    await deleteEntry(pid, 'dest/x (3).jpg')
    expect(await storage.exists(p('dest/x (3).jpg'))).toBe(false)
    expect(await storage.exists(p('dest/x (3).jpg.ink.json'))).toBe(false)
  })

  it('書き込みに置いた画像のフォルダは隠し、元のファイルと一緒に動かす', async () => {
    await createFolder(pid, '', 'dest')
    await createFile(pid, '', 'a.pdf', 'pdf')
    await storage.writeFile(p('a.pdf.ink.assets/x.png'), 'X')
    // 元のファイルが無いものは見せる
    await storage.writeFile(p('lost.pdf.ink.assets/y.png'), 'Y')
    expect((await listChildren(pid, '')).map((e) => e.name).sort()).toEqual(['a.pdf', 'dest', 'lost.pdf.ink.assets'])
    await renameEntry(pid, 'a.pdf', 'b.pdf')
    expect(await storage.readText(p('b.pdf.ink.assets/x.png'))).toBe('X')
    expect(await moveEntry(pid, 'b.pdf', 'dest')).toBe('dest/b.pdf')
    expect(await duplicateEntry(pid, 'dest/b.pdf')).toBe('dest/b (2).pdf')
    expect(await storage.readText(p('dest/b (2).pdf.ink.assets/x.png'))).toBe('X')
    await deleteEntry(pid, 'dest/b.pdf')
    expect(await storage.exists(p('dest/b.pdf.ink.assets'))).toBe(false)
  })
})
