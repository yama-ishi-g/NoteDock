import { describe, expect, it } from 'vitest'
import { CHANGELOG } from './changelog'
import { appVersion } from './version'

describe('バージョンアップ履歴', () => {
  it('先頭がアプリのバージョンと一致し、新しい順に並ぶ', () => {
    expect(CHANGELOG[0].version).toBe(appVersion)
    const num = (v: string) => v.split('.').reduce((n, p) => n * 1000 + Number(p), 0)
    for (let i = 1; i < CHANGELOG.length; i++) expect(num(CHANGELOG[i - 1].version)).toBeGreaterThan(num(CHANGELOG[i].version))
  })
})
