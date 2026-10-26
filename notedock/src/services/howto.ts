import { NOTE_JSON, inkPath, newInkBlock, newTextBlock, type ImageBlock, type NoteDoc } from '../formats/notedock'
import { projectFilesDir } from '../formats/project'
import { getStorage } from '../storage'
import { joinPath } from '../storage/paths'
import { createProject, listProjects } from './projects'

// 初めて起動したときに用意する「使い方」プロジェクト

export const HOWTO_PROJECT_NAME = '使い方'

const README = `# NoteDock へようこそ

NoteDock は、iPad で使うオフラインのノートアプリです。
文章・手書き・PDF・画像を、**プロジェクト**ごとにまとめて保存できます。

このプロジェクトは使い方の説明です。読み終わったら、削除してかまいません
（設定画面の「使い方プロジェクトを追加」から、いつでも作り直せます）。

## 画面の見かた

- 左側が**ツリー**（フォルダとファイルの一覧）、右側が開いたファイルです
- 左上のボタンで、ツリーの表示・非表示を切り替えます
- iPad を縦向きにすると、ファイルを開いたときにツリーが自動で閉じます

## ファイルやフォルダを作る

- ツリーの上の **［＋ 追加］** から作ります
  - 新しいフォルダ / テキスト（.txt）/ Markdown（.md）
  - 新しいノート（文章・手書き・画像）/ 新しい手書きノート
  - ファイルを取り込む / カメラで撮る
- フォルダを選んでから［追加］を押すと、そのフォルダの中に作られます

## 名前の変更・移動・削除

- 各行の右端の **「…」**、または行の**長押し**でメニューが開きます
- 名前の変更 / 移動 / 複製 / 書き出し / 削除

## 保存について

- 書いた内容は**自動で保存**されます（右上に「保存済み」と表示）
- データはこの iPad の中だけに保存されます。インターネットに送られることはありません
- 大事なデータは、ときどき**書き出し（ZIP）**でバックアップしてください →「5_バックアップとWindows.md」

## 次に読むもの

1. 2_テキストとMarkdown.md
2. 3_手書きと混在ノート.mixdock
3. 4_PDF・画像への書き込み.md
4. 5_バックアップとWindows.md
`

const TEXT = `# テキストと Markdown

## 文字の入力

- キーボードでも、**Apple Pencil で直接書いても**入力できます（スクリブル）
- Pencil で書いた文字は、自動でテキストに変換されます
  - 書けない場合は、iPad の「設定」→「Apple Pencil」→「スクリブル」を ON にしてください

## Markdown の書き方

.md ファイルは、右上の **［編集］［プレビュー］** で表示を切り替えられます。

| 書き方 | 表示 |
|---|---|
| \`# 見出し\` | 大きな見出し |
| \`## 小見出し\` | 小さな見出し |
| \`- 項目\` | 箇条書き |
| \`1. 項目\` | 番号付きの箇条書き |
| \`**太字**\` | **太字** |
| \`[リンク](https://example.com)\` | リンク |

> 引用は、行の先頭に「>」を付けます。

## 文字コード

- Windows で作った Shift_JIS のテキストも、文字化けせずに開けます
- 保存すると UTF-8 になります（改行コードはそのまま）
`

const PDF_IMAGE = `# PDF・画像への書き込み

## 書き込む

- PDF や画像を開くと、上に手書きのツールバーが表示されます
- **元のファイルは変更されません**。書き込みは別に保存されます
- このプロジェクトの「練習用の画像.png」で試してみてください

## 拡大・縮小・移動

- **指2本**でピンチすると拡大・縮小、指2本で動かすと移動します
- **指1本**でスクロールします（ツールバーの手のボタンで「指で描く」にすると、指で書き込めます）
- ［－］［＋］［幅に合わせる］ボタンでも拡大・縮小できます
- PDF は、上の「3 / 24」のようなページ番号を押すと、ページを移動できます

## 書き込んだファイルを書き出す

- ツリーの「…」→「書き出し」で、書き出し方を選べます
  - **書き込みを焼き込む**（名前に「_書き込み」を付ける / 元の名前のまま）
  - **元のファイル**（書き込みなし）
- iPad では、共有シートの「"ファイル"に保存」「画像を保存」で保存できます

## 取り込める形式

PDF / PNG / JPEG / WebP / HEIC（iPhone・iPad の写真。JPEG に変換して取り込みます）
`

const BACKUP = `# バックアップと Windows とのやり取り

## バックアップ（大切です）

データはこの iPad の中だけにあります。iPad の空き容量が少なくなると、
まれにデータが消えることがあるため、ときどき書き出してください。

- プロジェクト一覧で、プロジェクトの **「…」→「書き出し（ZIP）」**
- すべてのプロジェクトをまとめるときは、**設定 →「全データの書き出し」**
- 最後の書き出しから30日たつと、一覧にお知らせが表示されます
- ホーム画面に追加して使うと、データが消えにくくなります

## iPad → Windows

1. プロジェクトを「書き出し（ZIP）」
2. 共有シートで「"ファイル"に保存」→ OneDrive などを選ぶ
3. Windows で ZIP を取り出す（Windows の Chrome / Edge で NoteDock を開いて「読み込み」もできます）

## Windows → iPad

1. Windows 版の NoteDock で書き出したり、ファイルをまとめた ZIP を OneDrive などに置く
2. iPad の NoteDock で、プロジェクト一覧の **［読み込み］** → ZIP を選ぶ
3. 同じ名前のプロジェクトがあれば、「上書き」か「別名で追加」を選べます

## 1つのファイルだけ取り込む

ツリーの［追加］→「ファイルを取り込む」で、ファイルアプリや写真から選べます。
`

function howtoNote(): { note: NoteDoc; inkId: string } {
  const now = new Date().toISOString()
  const ink = newInkBlock('grid', 700)
  const note: NoteDoc = {
    formatVersion: 1,
    kind: 'mixed',
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    blocks: [
      newTextBlock(`# 手書きと混在ノート

このファイルは「ノート」です。**文章・手書き・画像**のブロックを縦に並べられます。

## 手書きのツール

上のツールバーで選びます。

- **ペン** / **マーカー** / **消しゴム**（なぞった部分だけ消えます）/ **投げ縄**（囲んで選び、動かす・複製・削除）
- 丸の大きさで太さ、色の丸で色を選びます
- **元に戻す・やり直し**は、ツールバーの矢印で
- 線の最後でペンを止めて少し待つと、**まっすぐな線**になります

下の方眼の欄で練習してみてください。`),
      ink,
      newTextBlock(`## ブロックの追加と並べ替え

- ノートの一番下の **［文章］［手書き］［画像］［カメラ］** で追加します
- ブロックの間の「＋」からも、その位置に追加できます
- ブロックの間や、ノートの下の余白を **Pencil で触れる**と、手書きブロックができます
- 各ブロックの右上の **「⋮」** で、上へ・下へ・複製・削除

## 文章ブロック

- 触れると入力できます。Markdown の書き方が使えます
- 何も書かずに離れると、そのブロックは消えます

## 指での操作

- 指でなぞると、ノートがスクロールします
- ツールバーの手のボタンで **「指で描く」** にすると、指でも描けます

## 書き出し

ツリーの「…」→「書き出し」で、**.mixdock**（NoteDock で開ける。手書きノートは .notedock）、**Markdown＋画像（ZIP）**、**PDF**（印刷画面から保存）を選べます。`),
    ],
  }
  return { note, inkId: ink.id }
}

/** 書き込みの練習用の画像（ブラウザの Canvas で作る。作れなければ null） */
async function practiceImage(): Promise<Blob | null> {
  try {
    const c = document.createElement('canvas')
    c.width = 1200
    c.height = 800
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#f6f6f4'
    ctx.fillRect(0, 0, 1200, 800)
    ctx.fillStyle = '#185fa5'
    ctx.font = 'bold 56px sans-serif'
    ctx.fillText('書き込みの練習', 80, 130)
    ctx.font = '32px sans-serif'
    ctx.fillStyle = '#444441'
    ctx.fillText('丸で囲んだり、矢印を描いたり、マーカーを引いたりしてみましょう', 80, 200)
    const shapes: [string, (x: number, y: number) => void][] = [
      ['#e24b4a', (x, y) => ctx.fillRect(x, y, 200, 200)],
      ['#639922', (x, y) => { ctx.beginPath(); ctx.arc(x + 100, y + 100, 100, 0, Math.PI * 2); ctx.fill() }],
      ['#ef9f27', (x, y) => { ctx.beginPath(); ctx.moveTo(x + 100, y); ctx.lineTo(x + 200, y + 200); ctx.lineTo(x, y + 200); ctx.closePath(); ctx.fill() }],
    ]
    shapes.forEach(([color, draw], i) => {
      ctx.fillStyle = color
      draw(120 + i * 340, 330)
    })
    ctx.fillStyle = '#888780'
    ctx.font = '28px sans-serif'
    ctx.fillText('四角', 185, 600)
    ctx.fillText('丸', 540, 600)
    ctx.fillText('三角', 865, 600)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
    c.width = 0
    c.height = 0
    return blob
  } catch {
    return null
  }
}

/** 使い方プロジェクトを作る。同じ名前があれば「使い方 (2)」にする */
export async function createHowToProject(): Promise<string> {
  const names = new Set((await listProjects()).map((p) => p.name))
  let name = HOWTO_PROJECT_NAME
  for (let n = 2; names.has(name); n++) name = `${HOWTO_PROJECT_NAME} (${n})`
  const meta = await createProject(name)
  const root = projectFilesDir(meta.id)
  const storage = getStorage()
  const w = (path: string, data: Blob | string) => storage.writeFile(joinPath(root, path), data)
  await w('1_はじめに.md', README)
  await w('2_テキストとMarkdown.md', TEXT)
  const { note, inkId } = howtoNote()
  const notePath = '3_手書きと混在ノート.mixdock'
  await w(`${notePath}/${inkPath(inkId)}`, JSON.stringify({ formatVersion: 1, strokes: [] }))
  const image = await practiceImage()
  if (image) {
    await w('練習用の画像.png', image)
    // ノートにも画像ブロックを入れて、画像の上に書き込めることを示す
    const id = crypto.randomUUID()
    const block: ImageBlock = { id, type: 'image', src: `images/${id}.png`, width: 1200, height: 800, caption: '練習用の画像' }
    await w(`${notePath}/${block.src}`, image)
    note.blocks.push(block)
  }
  await w(`${notePath}/${NOTE_JSON}`, JSON.stringify(note, null, 2))
  await w('4_PDF・画像への書き込み.md', PDF_IMAGE)
  await w('5_バックアップとWindows.md', BACKUP)
  return meta.id
}
