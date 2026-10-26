import { useState, type ChangeEvent } from 'react'
import { setResult } from './report'

// 0-9 共有シートとファイル選択（写真ライブラリ・カメラ・ファイル、HEICの渡され方）
type PickedFile = {
  source: string
  name: string
  type: string
  size: number
  width?: number
  height?: number
  thumb?: string
  jpegSize?: number
  error?: string
}

const fmtKB = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`)

const isHeic = (f: File) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)

async function inspect(file: File, source: string): Promise<PickedFile> {
  const info: PickedFile = { source, name: file.name, type: file.type || '(空)', size: file.size }
  if (!file.type.startsWith('image/') && !isHeic(file)) return info
  try {
    const bmp = await createImageBitmap(file)
    info.width = bmp.width
    info.height = bmp.height
    // サムネイルと、JPEGに変換したときの大きさ（HEIC変換の確認）
    const scale = Math.min(1, 160 / Math.max(bmp.width, bmp.height))
    const thumb = document.createElement('canvas')
    thumb.width = Math.round(bmp.width * scale)
    thumb.height = Math.round(bmp.height * scale)
    thumb.getContext('2d')!.drawImage(bmp, 0, 0, thumb.width, thumb.height)
    info.thumb = thumb.toDataURL('image/jpeg', 0.8)
    const full = document.createElement('canvas')
    full.width = bmp.width
    full.height = bmp.height
    full.getContext('2d')!.drawImage(bmp, 0, 0)
    const jpeg = await new Promise<Blob | null>((r) => full.toBlob(r, 'image/jpeg', 0.9))
    info.jpegSize = jpeg?.size
    bmp.close()
  } catch (err) {
    info.error = `画像として読めない: ${String(err)}`
  }
  return info
}

// 1ページの簡単なPDFを作る（共有テスト用）
function makeTestPdf(): Uint8Array {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  const content = 'BT /F1 24 Tf 72 760 Td (NoteDock share test) Tj ET'
  objs[3] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(pdf)
}

async function makeTestPng(): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = 600
  c.height = 400
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, 600, 400)
  ctx.strokeStyle = '#e24b4a'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(60, 300)
  ctx.bezierCurveTo(160, 60, 320, 380, 540, 100)
  ctx.stroke()
  ctx.fillStyle = '#185fa5'
  ctx.font = '32px sans-serif'
  ctx.fillText('NoteDock 共有テスト', 60, 70)
  return new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))
}

export default function FilesSection() {
  const [files, setFiles] = useState<PickedFile[]>([])
  const [shareLog, setShareLog] = useState<string[]>([])

  const onPick = (source: string) => async (e: ChangeEvent<HTMLInputElement>) => {
    const list = [...(e.target.files ?? [])]
    e.target.value = ''
    const infos = await Promise.all(list.map((f) => inspect(f, source)))
    setFiles((prev) => [...infos, ...prev])
    for (const f of infos) {
      setResult(`0-9 取り込み ${source} ${f.name}`, `type=${f.type} ${fmtKB(f.size)}${f.width ? ` ${f.width}x${f.height}` : ''}${f.jpegSize ? ` JPEG変換後=${fmtKB(f.jpegSize)}` : ''}${f.error ? ` ${f.error}` : ''}`)
    }
  }

  const log = (msg: string) => {
    setShareLog((prev) => [msg, ...prev])
  }

  const share = async (label: string, make: () => Promise<File>) => {
    try {
      const file = await make()
      const can = navigator.canShare?.({ files: [file] }) ?? false
      if (can) {
        await navigator.share({ files: [file], title: file.name })
        log(`${label}: 共有シートで完了`)
        setResult(`0-9 共有 ${label}`, '共有シート OK')
      } else {
        const url = URL.createObjectURL(file)
        const a = document.createElement('a')
        a.href = url
        a.download = file.name
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        log(`${label}: 共有シート非対応のためダウンロード`)
        setResult(`0-9 共有 ${label}`, 'canShare=false → ダウンロード')
      }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      log(`${label}: ${aborted ? 'キャンセルされた' : `失敗 ${String(err)}`}`)
      if (!aborted) setResult(`0-9 共有 ${label}`, `失敗 ${String(err)}`)
    }
  }

  return (
    <section id="lab-files">
      <h2>0-9 ファイル選択と共有シート</h2>
      <h3 style={{ fontSize: 15, margin: '8px 0 4px' }}>取り込み</h3>
      <div className="row">
        <label className="filebtn">画像を選ぶ（写真・カメラ・ファイル）<input type="file" accept="image/*,.heic,.heif" multiple onChange={onPick('画像')} /></label>
        <label className="filebtn">カメラで撮る<input type="file" accept="image/*" capture="environment" onChange={onPick('カメラ')} /></label>
        <label className="filebtn">ファイルを選ぶ（PDF・テキスト）<input type="file" accept=".pdf,.txt,.md,.zip,application/pdf,text/plain" multiple onChange={onPick('ファイル')} /></label>
      </div>
      <p className="hint">「画像を選ぶ」で 写真ライブラリ／写真を撮る／ファイルを選択 の選択肢が出るか。写真ライブラリのHEIC写真がどの形式で届くか（type欄）を確認</p>
      {files.map((f, i) => (
        <div key={i} className="row" style={{ alignItems: 'flex-start', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {f.thumb && <img src={f.thumb} alt="" style={{ maxWidth: 80, maxHeight: 80, borderRadius: 4 }} />}
          <dl className="kv" style={{ flex: 1 }}>
            <dt>取り込み元</dt><dd>{f.source}</dd>
            <dt>名前</dt><dd>{f.name}</dd>
            <dt>形式</dt><dd>{f.type}</dd>
            <dt>大きさ</dt><dd>{fmtKB(f.size)}{f.width ? `（${f.width} × ${f.height}、${((f.width * f.height!) / 1e6).toFixed(1)}M画素）` : ''}</dd>
            {f.jpegSize !== undefined && <><dt>JPEG変換後</dt><dd>{fmtKB(f.jpegSize)}</dd></>}
            {f.error && <><dt>エラー</dt><dd className="ng">{f.error}</dd></>}
          </dl>
        </div>
      ))}
      <h3 style={{ fontSize: 15, margin: '16px 0 4px' }}>共有シート（書き出し）</h3>
      <div className="row">
        <button onClick={() => share('PNG', async () => new File([await makeTestPng()], 'NoteDockテスト.png', { type: 'image/png' }))}>PNGを共有</button>
        <button onClick={() => share('PDF', async () => new File([makeTestPdf() as BlobPart], 'NoteDockテスト.pdf', { type: 'application/pdf' }))}>PDFを共有</button>
        <button onClick={() => share('ZIP相当', async () => new File(['dummy'], 'NoteDockテスト.zip', { type: 'application/zip' }))}>ZIP（仮）を共有</button>
      </div>
      <p className="hint">PNG: 「画像を保存」と「"ファイル"に保存」が出るか。PDF・ZIP: 「"ファイル"に保存」で好きなフォルダに保存できるか。同じ名前で保存したとき置き換えの確認が出るか</p>
      {shareLog.map((l, i) => <div key={i} className="log">{l}</div>)}
    </section>
  )
}
