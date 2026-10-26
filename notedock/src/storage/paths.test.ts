import { describe, expect, it } from 'vitest'
import { basename, dirname, extname, joinPath, normalizePath, stem, uniqueName, validateName } from './paths'

describe('validateName', () => {
  it('普通の名前は通す', () => {
    expect(validateName('メモ.txt')).toBeNull()
    expect(validateName('議事録 2026')).toBeNull()
  })
  it('Windowsで使えない文字・空・長すぎる名前を拒否する', () => {
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) expect(validateName(bad)).not.toBeNull()
    expect(validateName('')).not.toBeNull()
    expect(validateName('   ')).not.toBeNull()
    expect(validateName('a'.repeat(101))).not.toBeNull()
  })
  it('末尾の空白・ピリオド、..、.tmp を拒否する', () => {
    expect(validateName('メモ.')).not.toBeNull()
    expect(validateName('メモ ')).not.toBeNull()
    expect(validateName('..')).not.toBeNull()
    expect(validateName('a.tmp')).not.toBeNull()
  })
})

describe('パスの操作', () => {
  it('結合と正規化', () => {
    expect(joinPath('projects', 'a/', '/b.txt')).toBe('projects/a/b.txt')
    expect(joinPath('', 'x')).toBe('x')
    expect(normalizePath('/a//b/./c')).toBe('a/b/c')
    expect(() => normalizePath('a/../b')).toThrow()
  })
  it('名前と拡張子', () => {
    expect(dirname('a/b/c.md')).toBe('a/b')
    expect(dirname('c.md')).toBe('')
    expect(basename('a/b/c.md')).toBe('c.md')
    expect(extname('写真.JPG')).toBe('jpg')
    expect(extname('.gitignore')).toBe('')
    expect(stem('a/b/メモ.tar.gz')).toBe('メモ.tar')
  })
})

describe('uniqueName', () => {
  it('重ならなければそのまま、重なれば (2)(3)…', () => {
    const names = new Set(['メモ.txt', 'メモ (2).txt', '資料'])
    expect(uniqueName('新規.txt', (n) => names.has(n))).toBe('新規.txt')
    expect(uniqueName('メモ.txt', (n) => names.has(n))).toBe('メモ (3).txt')
    expect(uniqueName('資料', (n) => names.has(n))).toBe('資料 (2)')
    expect(uniqueName('メモ (2).txt', (n) => names.has(n))).toBe('メモ (3).txt')
  })
})
