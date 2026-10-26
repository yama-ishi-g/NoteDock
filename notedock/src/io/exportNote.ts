import { zipSync, type Zippable } from 'fflate'
import { INK_LOGICAL_WIDTH, type NoteDoc } from '../formats/notedock'
import type { Stroke } from '../ink/model'
import { strokePath } from '../ink/render'
import { renderMarkdown } from '../lib/markdown'
import { loadSidecar } from '../services/annotations'
import { loadInk, loadNote, readNoteFile } from '../services/notes'
import { extname, stem } from '../storage/paths'
import { toBytes } from '../storage/StorageService'
import { composeImage } from './burn'
import { makeFile } from './share'

// 混在ノートの書き出し（内部仕様書 8.4）: Markdown＋PNG（ZIP）、印刷による PDF

/** 手書きブロックを PNG にする（論理幅1000を scale 倍で描く。背景は白） */
export async function renderInkPng(strokes: Stroke[], height: number, scale = 2): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = INK_LOGICAL_WIDTH * scale
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  for (const s of strokes) {
    ctx.globalAlpha = s.opacity
    ctx.fillStyle = s.color
    ctx.fill(strokePath(s))
  }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を作れませんでした'))), 'image/png'))
  canvas.width = 0
  canvas.height = 0
  return blob
}

/** 手書きの線がある下端まで切り詰めた高さ（余白を少し残す） */
function trimmedHeight(strokes: Stroke[], height: number): number {
  let maxY = 0
  for (const s of strokes) for (let i = 1; i < s.points.length; i += 4) maxY = Math.max(maxY, s.points[i] + s.size)
  return Math.min(height, Math.max(120, Math.ceil(maxY + 40)))
}

type Asset = { name: string; blob: Blob }
type Part = { kind: 'text'; markdown: string } | { kind: 'asset'; asset: Asset; alt: string }

/** ノートを、文章と画像（手書き・書き込みを合成した画像）の並びにする */
async function collectParts(projectId: string, notePath: string, note: NoteDoc): Promise<Part[]> {
  const parts: Part[] = []
  let inkNo = 0
  let imageNo = 0
  for (const b of note.blocks) {
    if (b.type === 'text') {
      if (b.markdown.trim()) parts.push({ kind: 'text', markdown: b.markdown })
    } else if (b.type === 'ink') {
      const strokes = await loadInk(projectId, notePath, b.id)
      if (!strokes.length) continue
      parts.push({ kind: 'asset', alt: '手書き', asset: { name: `ink-${++inkNo}.png`, blob: await renderInkPng(strokes, trimmedHeight(strokes, b.height)) } })
    } else {
      const file = await readNoteFile(projectId, notePath, b.src)
      const sidecar = await loadSidecar(projectId, `${notePath}/${b.src}`, 'image-px')
      const strokes = sidecar.pages['0']?.strokes ?? []
      const jpeg = ['jpg', 'jpeg'].includes(extname(b.src))
      const blob = strokes.length ? await composeImage(file, strokes, jpeg) : file
      const ext = strokes.length ? (jpeg ? 'jpg' : 'png') : extname(b.src) || 'jpg'
      parts.push({ kind: 'asset', alt: b.caption ?? '画像', asset: { name: `image-${++imageNo}.${ext}`, blob } })
    }
  }
  return parts
}

const noteName = (notePath: string) => stem(notePath.slice(notePath.lastIndexOf('/') + 1))

/** Markdown＋画像を ZIP にする（ノート名.md と assets/） */
export async function exportNoteMarkdown(projectId: string, notePath: string): Promise<File> {
  const note = await loadNote(projectId, notePath)
  const parts = await collectParts(projectId, notePath, note)
  const name = noteName(notePath)
  const entries: Zippable = {}
  const md: string[] = []
  for (const p of parts) {
    if (p.kind === 'text') md.push(p.markdown.trim())
    else {
      entries[`assets/${p.asset.name}`] = [await toBytes(p.asset.blob), { level: 0 }]
      md.push(`![${p.alt}](assets/${p.asset.name})`)
    }
  }
  entries[`${name}.md`] = new TextEncoder().encode(md.join('\n\n') + '\n')
  return makeFile(zipSync(entries), `${name}.zip`)
}

/**
 * 印刷用に整形する。返した関数を呼ぶと印刷画面を開く（タップの直後に呼ぶ）。
 * iPad では印刷画面から「PDFとして保存」できる（文字は画像にしないため、PDF で選択・検索できる）
 */
export async function preparePrint(projectId: string, notePath: string): Promise<{ print: () => void; cancel: () => void }> {
  const note = await loadNote(projectId, notePath)
  const parts = await collectParts(projectId, notePath, note)
  const urls: string[] = []
  const root = document.createElement('div')
  root.id = 'print-root'
  const title = document.createElement('h1')
  title.className = 'print-title'
  title.textContent = noteName(notePath)
  root.appendChild(title)
  const loads: Promise<void>[] = []
  for (const p of parts) {
    if (p.kind === 'text') {
      const div = document.createElement('div')
      div.className = 'markdown-body'
      div.innerHTML = renderMarkdown(p.markdown)
      root.appendChild(div)
    } else {
      const url = URL.createObjectURL(p.asset.blob)
      urls.push(url)
      const img = document.createElement('img')
      img.alt = p.alt
      loads.push(new Promise((r) => {
        img.onload = () => r()
        img.onerror = () => r()
      }))
      img.src = url
      root.appendChild(img)
    }
  }
  document.body.appendChild(root)
  document.body.classList.add('printing')
  await Promise.all(loads)
  const cleanup = () => {
    root.remove()
    document.body.classList.remove('printing')
    urls.forEach((u) => URL.revokeObjectURL(u))
    window.removeEventListener('afterprint', cleanup)
  }
  return {
    print: () => {
      window.addEventListener('afterprint', cleanup)
      window.print()
      // afterprint が来ない環境のために、少し待ってから片付ける
      setTimeout(cleanup, 60_000)
    },
    cancel: cleanup,
  }
}
