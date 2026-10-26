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
  it('バージョンとビルド日時（端末の時刻）を表示する（コミット番号は出さない）', () => {
    const time = new Date(2026, 9, 26, 9, 5).toISOString()
    expect(formatBuildLabel('1.0.0', time)).toBe('v1.0.0（10/26 09:05）')
  })

  it('日時が読めない場合は - にする', () => {
    expect(formatBuildLabel('1.0.0', 'x')).toBe('v1.0.0（-）')
  })
})
