import { beforeEach, describe, expect, it } from 'vitest'
import { setStorage } from '../storage'
import { MemoryStorage } from '../storage/MemoryStorage'
import { ensureHowToProject } from './appData'
import { listChildren } from './files'
import { createHowToProject } from './howto'
import { loadNote } from './notes'
import { deleteProject, listProjects } from './projects'

beforeEach(() => {
  setStorage(new MemoryStorage())
})

describe('使い方プロジェクト', () => {
  it('説明のファイルとノートを用意する', async () => {
    const id = await createHowToProject()
    const names = (await listChildren(id, '')).map((n) => n.name)
    expect(names).toEqual(['1_はじめに.md', '2_テキストとMarkdown.md', '3_手書きと混在ノート.mixdock', '4_PDF・画像への書き込み.md', '5_バックアップとWindows.md'])
    const note = await loadNote(id, '3_手書きと混在ノート.mixdock')
    expect(note.blocks.map((b) => b.type)).toEqual(['text', 'ink', 'text'])
  })

  it('同じ名前があれば (2) にする', async () => {
    await createHowToProject()
    await createHowToProject()
    expect((await listProjects()).map((p) => p.name).sort()).toEqual(['使い方', '使い方 (2)'])
  })
})

describe('ensureHowToProject', () => {
  it('1回だけ作り、削除しても作り直さない', async () => {
    expect(await ensureHowToProject()).toBe(true)
    const [p] = await listProjects()
    await deleteProject(p.id)
    expect(await ensureHowToProject()).toBe(false)
    expect(await listProjects()).toEqual([])
  })
})
