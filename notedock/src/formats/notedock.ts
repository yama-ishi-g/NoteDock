import type { Stroke } from '../ink/model'

// ノートの形式（内部仕様書 5.4）。アプリ内ではフォルダとして持つ
//   .notedock  混在ノート（文章・手書き・画像）
//   .inkdock   手書きノート（手書きブロック1つ。形式は .notedock と同じ。ツリーで見分けるために拡張子を分ける）
//   note.json            ノートの構成
//   ink/{blockId}.json   手書きブロックの線

export const NOTE_EXT = 'notedock'
export const INK_NOTE_EXT = 'inkdock'
export const NOTE_EXTS = [NOTE_EXT, INK_NOTE_EXT] as const
export const isNoteExt = (ext: string) => (NOTE_EXTS as readonly string[]).includes(ext.toLowerCase())
export const NOTE_JSON = 'note.json'
/** 手書きブロックの論理座標の横幅 */
export const INK_LOGICAL_WIDTH = 1000
/** 新しい手書きブロックの高さ（論理座標） */
export const DEFAULT_INK_HEIGHT = 1400
export const GROW_STEP = 400
/** 混在ノートに追加する手書きブロックの高さ（論理座標） */
export const BLOCK_INK_HEIGHT = 500
/** つまみで縮められる手書きブロックの最小の高さ（論理座標） */
export const MIN_INK_HEIGHT = 120
/** 画像ブロックの表示幅（ノートの幅に対する割合）の範囲 */
export const MIN_IMAGE_RATIO = 0.2

export type InkBackground = 'plain' | 'grid'

export type TextBlock = { id: string; type: 'text'; markdown: string }
export type InkBlock = { id: string; type: 'ink'; height: number; background: InkBackground }
export type ImageBlock = {
  id: string
  type: 'image'
  src: string
  /** 画像のピクセル数 */
  width: number
  height: number
  caption?: string
  /** 表示幅（ノートの幅に対する割合、0.2〜1）。なければ 1 */
  displayRatio?: number
}
export type Block = TextBlock | InkBlock | ImageBlock

export type NoteDoc = {
  formatVersion: 1
  id: string
  createdAt: string
  updatedAt: string
  blocks: Block[]
}

export type InkData = { formatVersion: 1; strokes: Stroke[] }

export const inkPath = (blockId: string) => `ink/${blockId}.json`

export function newInkBlock(background: InkBackground = 'grid', height = DEFAULT_INK_HEIGHT): InkBlock {
  return { id: crypto.randomUUID(), type: 'ink', height, background }
}

export function newTextBlock(markdown = ''): TextBlock {
  return { id: crypto.randomUUID(), type: 'text', markdown }
}

/** 文章から始まる混在ノート（新規ノート） */
export function newMixedNote(): NoteDoc {
  const now = new Date().toISOString()
  return { formatVersion: 1, id: crypto.randomUUID(), createdAt: now, updatedAt: now, blocks: [newTextBlock()] }
}

/** 画像ブロックの画像のパス（ノートのフォルダからの相対パス） */
export const imagePath = (block: ImageBlock) => block.src

/** 手書きブロック1つだけのノート（新規手書きノート） */
export function newHandwritingNote(): NoteDoc {
  const now = new Date().toISOString()
  return { formatVersion: 1, id: crypto.randomUUID(), createdAt: now, updatedAt: now, blocks: [newInkBlock()] }
}

export function migrateNote(raw: unknown): NoteDoc {
  const n = raw as Partial<NoteDoc>
  if (!n || !Array.isArray(n.blocks)) throw new Error('note.json の形式が正しくありません')
  const now = new Date().toISOString()
  return {
    formatVersion: 1,
    id: n.id ?? crypto.randomUUID(),
    createdAt: n.createdAt ?? now,
    updatedAt: n.updatedAt ?? now,
    blocks: n.blocks.filter((b): b is Block => !!b && typeof b.id === 'string' && ['text', 'ink', 'image'].includes(b.type)),
  }
}

export function migrateInk(raw: unknown): InkData {
  const d = raw as Partial<InkData>
  const strokes = Array.isArray(d?.strokes) ? d.strokes.filter((s) => s && typeof s.id === 'string' && Array.isArray(s.points)) : []
  return { formatVersion: 1, strokes }
}
