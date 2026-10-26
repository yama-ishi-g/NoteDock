import { describe, expect, it } from 'vitest'
import { appVersion } from './version'

describe('appVersion', () => {
  it('package.json のバージョンが埋め込まれる', () => {
    expect(appVersion).toMatch(/^\d+\.\d+\.\d+/)
  })
})
