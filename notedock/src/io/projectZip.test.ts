import { zipSync, strToU8 } from 'fflate'
import { beforeEach, describe, expect, it } from 'vitest'
import { projectFilesDir } from '../formats/project'
import { createFile, createFolder, listChildren } from '../services/files'
import { createProject, listProjects } from '../services/projects'
import { setStorage } from '../storage'
import { MemoryStorage } from '../storage/MemoryStorage'
import { exportAllZip, exportProjectZip, importZipProject, parseProjectZip } from './projectZip'

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
  setStorage(storage)
})

const bytesOf = async (f: File) => new Uint8Array(await f.arrayBuffer())

describe('プロジェクトZIP', () => {
  it('書き出して読み込むと同じ内容になる（空のフォルダ・付属ファイルも）', async () => {
    const meta = await createProject('業務メモ')
    await createFolder(meta.id, '', '議事録')
    await createFolder(meta.id, '', '空のフォルダ')
    await createFile(meta.id, '議事録', '10月.md', '# 10月')
    await createFile(meta.id, '', '資料.pdf', 'PDF')
    await storage.writeFile(`${projectFilesDir(meta.id)}/資料.pdf.ink.json`, '{"pages":{}}')

    const zip = await exportProjectZip(meta.id)
    expect(zip.name).toMatch(/^業務メモ_\d{8}\.zip$/)
    const [zp] = parseProjectZip(await bytesOf(zip), zip.name)
    expect(zp.name).toBe('業務メモ')
    expect(zp.meta?.name).toBe('業務メモ')

    // 同じ名前があるので別名で追加
    const added = await importZipProject(zp, 'new')
    expect(added.name).toBe('業務メモ (2)')
    expect((await listChildren(added.id, '')).map((n) => n.name)).toEqual(['議事録', '空のフォルダ', '資料.pdf'])
    expect(await storage.readText(`${projectFilesDir(added.id)}/議事録/10月.md`)).toBe('# 10月')
    expect(await storage.readText(`${projectFilesDir(added.id)}/資料.pdf.ink.json`)).toBe('{"pages":{}}')
  })

  it('上書きは古いプロジェクトを置き換える', async () => {
    const meta = await createProject('A')
    await createFile(meta.id, '', 'old.txt', 'old')
    const zip = zipSync({ 'notedock-project.json': strToU8(JSON.stringify({ ...meta })), 'new.txt': strToU8('new') })
    const [zp] = parseProjectZip(zip, 'A.zip')
    const replaced = await importZipProject(zp, 'overwrite')
    const projects = await listProjects()
    expect(projects.map((p) => p.name)).toEqual(['A'])
    expect(projects[0].id).toBe(replaced.id)
    expect((await listChildren(replaced.id, '')).map((n) => n.name)).toEqual(['new.txt'])
  })

  it('普通のZIP: 最上位のフォルダが1つならその中身をルートにする', () => {
    const zip = zipSync({ '資料/a.txt': strToU8('a'), '資料/sub/b.txt': strToU8('b'), '__MACOSX/x': strToU8('') })
    const [zp] = parseProjectZip(zip, 'download.zip')
    expect(zp.name).toBe('資料')
    expect([...zp.files.keys()].sort()).toEqual(['a.txt', 'sub/b.txt'])
  })

  it('普通のZIP: 最上位にファイルがあればZIPの名前をプロジェクト名にする', () => {
    const zip = zipSync({ 'a.txt': strToU8('a'), 'f/b.txt': strToU8('b') })
    expect(parseProjectZip(zip, '持ち出し.zip')[0].name).toBe('持ち出し')
  })

  it('全データの書き出しは、プロジェクトごとに読み込める', async () => {
    const a = await createProject('A')
    await createFile(a.id, '', 'a.txt', 'a')
    const b = await createProject('B')
    await createFile(b.id, '', 'b.txt', 'b')
    const zip = await exportAllZip()
    const parsed = parseProjectZip(await bytesOf(zip), zip.name)
    expect(parsed.map((p) => p.name).sort()).toEqual(['A', 'B'])
    expect([...parsed.find((p) => p.name === 'B')!.files.keys()]).toEqual(['b.txt'])
  })
})
