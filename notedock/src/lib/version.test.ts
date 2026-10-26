import { describe, expect, it } from 'vitest'
import { appVersion, buildCommit, formatBuildLabel } from './version'

describe('appVersion', () => {
  it('package.json のバージョンが埋め込まれる', () => {
    expect(appVersion).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('コミット番号が埋め込まれる', () => {
    expect(buildCommit).toMatch(/^([0-9a-f]{7,}|dev)$/)
  })
})

describe('formatBuildLabel', () => {
  it('バージョン・コミット番号・ビルド日時（端末の時刻）を表示する', () => {
    const time = new Date(2026, 9, 26, 9, 5).toISOString()
    expect(formatBuildLabel('0.1.0', '54cb01b', time)).toBe('v0.1.0（54cb01b・10/26 09:05）')
  })

  it('日時が読めない場合は - にする', () => {
    expect(formatBuildLabel('0.1.0', 'dev', 'x')).toBe('v0.1.0（dev・-）')
  })
})
