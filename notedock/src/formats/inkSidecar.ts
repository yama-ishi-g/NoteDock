import { migrateItems, type InkItem } from '../ink/items'
import type { Stroke } from '../ink/model'

// PDF・画像への書き込みを保存する付属ファイル（xxx.pdf.ink.json / xxx.jpg.ink.json。内部仕様書 5.3）
// 元のファイルは変更しない

export type InkPage = { width: number; height: number; strokes: Stroke[]; items?: InkItem[] }

export type InkSidecar = {
  formatVersion: 1
  /** 元ファイルの確認用 */
  target: { name: string; size: number; lastModified: number }
  /** pdf-page: pdf.js の getViewport({ scale: 1, rotation }) の座標（pt）、image-px: 画像のピクセル */
  coordSpace: 'pdf-page' | 'image-px'
  pages: { [pageIndex: string]: InkPage }
}

export function emptySidecar(coordSpace: InkSidecar['coordSpace'], target: InkSidecar['target']): InkSidecar {
  return { formatVersion: 1, target, coordSpace, pages: {} }
}

export function migrateSidecar(raw: unknown, coordSpace: InkSidecar['coordSpace'], target: InkSidecar['target']): InkSidecar {
  const s = raw as Partial<InkSidecar>
  if (!s || typeof s.pages !== 'object' || s.pages === null) return emptySidecar(coordSpace, target)
  const pages: InkSidecar['pages'] = {}
  for (const [k, p] of Object.entries(s.pages)) {
    if (!p || !Array.isArray(p.strokes)) continue
    pages[k] = { width: Number(p.width) || 0, height: Number(p.height) || 0, strokes: p.strokes.filter((st) => st && typeof st.id === 'string' && Array.isArray(st.points)), items: migrateItems(p.items) }
  }
  return { formatVersion: 1, target: s.target ?? target, coordSpace: s.coordSpace ?? coordSpace, pages }
}

/** 書き込み（線または置いたもの）があるか */
export const hasStrokes = (s: InkSidecar | null | undefined) => !!s && Object.values(s.pages).some((p) => p.strokes.length > 0 || (p.items?.length ?? 0) > 0)
