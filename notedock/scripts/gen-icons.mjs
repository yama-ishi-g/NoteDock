// アプリアイコン（PNG）を生成する。デザインを変えたときだけ手動で実行する: node scripts/gen-icons.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')

const BLUE = [0x18, 0x5f, 0xa5]
const WHITE = [0xff, 0xff, 0xff]

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

// 角丸四角の内側か（u, v は 0〜1 の正規化座標）
const inRoundRect = (u, v, x0, y0, x1, y1, r) => {
  if (u < x0 || u > x1 || v < y0 || v > y1) return false
  const cx = Math.min(Math.max(u, x0 + r), x1 - r)
  const cy = Math.min(Math.max(v, y0 + r), y1 - r)
  return (u - cx) ** 2 + (v - cy) ** 2 <= r * r
}

// maskable=true のときは全面を背景色にし、絵柄を中央80%（安全領域）に収める
function render(size, { maskable = false, rounded = true } = {}) {
  const scale = maskable ? 0.7 : 1
  const off = (1 - scale) / 2
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      const bg = maskable || !rounded ? true : inRoundRect(u, v, 0, 0, 1, 1, 0.22)
      // 絵柄の座標系（0〜1）
      const p = (u - off) / scale
      const q = (v - off) / scale
      let color = null
      let alpha = 0
      if (bg) {
        color = BLUE
        alpha = 255
      }
      if (inRoundRect(p, q, 0.25, 0.19, 0.75, 0.81, 0.06)) color = WHITE
      for (const [ly, lx1] of [[0.375, 0.66], [0.485, 0.66], [0.595, 0.53]]) {
        if (inRoundRect(p, q, 0.34, ly - 0.025, lx1, ly + 0.025, 0.025)) color = BLUE
      }
      if (color) {
        if (!alpha) alpha = 255
        row.set([...color, alpha], 1 + x * 4)
      }
    }
    rows.push(row)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-512-maskable.png', 512, { maskable: true }],
  // iOS は自前で角丸にするため、四角いまま塗りつぶす
  ['apple-touch-icon-180.png', 180, { rounded: false }],
]
for (const [name, size, opts] of targets) {
  writeFileSync(join(outDir, name), render(size, opts))
  console.log(`generated ${name}`)
}
