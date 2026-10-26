import { eraserPath, eraseStrokes, lassoSelect, shouldSnapLine, strokesInRect, toLine, transformStroke, translateStroke } from './geometry'
import { InkHistory } from './history'
import type { AssetResolver } from './assets'
import { fontSizeFor, newImageItem, newTextItem, type InkItem } from './items'
import {
  ERASER_RADII, MARKER_OPACITY, MARKER_SIZES, newStrokeId, PEN_SIZES, rectsIntersect, unionBounds,
  type InkTool, type Point, type Rect, type SizeLevel, type Stroke, type Tool,
} from './model'
import { cachedBounds, cachedPath, drawStroke, strokePath } from './render'

// 手書き面（内部仕様書 6.1〜6.7）。React に依存しない。
// 座標は論理座標（手書きブロックは横幅1000）。画面には scale 倍して表示する。
// Canvas は手書き面のうち画面に見えている部分だけを覆い、スクロールに合わせて描き直す（縦に長いノートでも Canvas の上限を超えない）

export type Selection = { ids: string[]; bounds: Rect }

/** 線と置いたもの（画像・テキストボックス）。元に戻すの単位 */
export type InkContent = { strokes: Stroke[]; items: InkItem[] }

/** 置いたもののどこに触れたか（React 側の表示から判定する） */
export type ItemHit = { id: string; handle: boolean }

export type InkEngineOptions = {
  /** 論理座標1あたりの画面上の px */
  scale: () => number
  /** スクロールする親要素（指のスクロールと、見えている範囲の計算に使う） */
  scroller: () => HTMLElement | null
  holdMs: () => number
  fingerDraw: () => boolean
  readOnly: () => boolean
  /** 確定した変更（保存する） */
  onChange: (strokes: Stroke[], items: InkItem[]) => void
  /** 置いたものの表示を更新する（移動中の途中経過も含む） */
  onItems?: (items: InkItem[], selectedId: string | null) => void
  /** 画面上の点が、置いたもの（とその大きさを変えるつまみ）に当たるか */
  hitTestItem?: (clientX: number, clientY: number) => ItemHit | null
  /** テキストボックスの編集を始める */
  onEditText?: (id: string) => void
  /** 手書き面の操作でテキストボックスの編集を終えた */
  onEndEdit?: () => void
  /** 座標系の横幅（文字の大きさ・画像を置く大きさの基準） */
  logicalWidth?: () => number
  /** 新しいテキストボックスの文字の大きさと色 */
  textStyle?: () => { level: SizeLevel; color: string }
  /** 置く画像の保存場所 */
  assets?: AssetResolver
  onSelection: (sel: Selection | null) => void
  onHistory: (canUndo: boolean, canRedo: boolean) => void
  /** 下端の近くまで描いたとき（論理座標の y） */
  onReachBottom?: (y: number) => void
  /** false のとき、描かない指の操作（スクロール・ピンチ）は親に任せる（PDF・画像の拡大表示） */
  touchPan?: boolean
}

const PALM_MS = 500
const HOLD_RADIUS_PX = 3
const MIN_LINE_PX = 20
const GROW_MARGIN = 100
const INERTIA_FRICTION = 0.9
const INERTIA_MIN_SPEED = 0.03
const INERTIA_MAX_SPEED = 3
/** Pointer Events が届かなかったとき、touch イベントから描く場合の pointerId */
const TOUCH_FALLBACK_ID = -1
/** Pencil の touchstart から pointerdown を待つ時間 */
const FALLBACK_WAIT_MS = 50

type ItemRect = { x: number; y: number; w: number; h: number }

const rectOf = (i: InkItem): ItemRect => ({ x: i.x, y: i.y, w: i.w, h: i.type === 'image' ? i.h : 0 })

type StylusTouch = { id: number; pointerSeen: boolean; buffer: Touch[]; timer: number }

// touch イベントを Pointer Events の代わりに使うための、最低限の形
function touchAsPointer(t: Touch): PointerEvent {
  const force = t.force > 0 ? Math.min(1, t.force) : 0.5
  return { pointerId: TOUCH_FALLBACK_ID, pointerType: 'pen', clientX: t.clientX, clientY: t.clientY, pressure: force, button: 0, preventDefault() {} } as unknown as PointerEvent
}

const stylusIn = (list: TouchList) => [...list].find((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')

type Gesture =
  | { kind: 'draw'; pointerId: number; type: string; stroke: Stroke; start: number; anchor: Point; lastMoveAt: number; flashUntil: number }
  | { kind: 'erase'; pointerId: number; type: string; before: InkContent; last: Point | null; changed: boolean }
  // attached: 画像の上に描いた線（動かす前のもの）。画像と一緒に動かす
  | { kind: 'itemMove'; pointerId: number; type: string; id: string; start: Point; orig: ItemRect; moved: boolean; wasSelected: boolean; before: InkContent; attached: Stroke[] }
  | { kind: 'itemResize'; pointerId: number; type: string; id: string; start: Point; orig: ItemRect; before: InkContent; attached: Stroke[] }
  /** 置いたものを指2本で動かす（画像はピンチで大きさも変える）。a・b は2本の指の画面座標 */
  | { kind: 'itemPinch'; pointerId: number; second: number; type: string; id: string; a0: Point; b0: Point; a: Point; b: Point; orig: ItemRect; before: InkContent; attached: Stroke[] }
  /** テキストボックスの編集中に、文字ツールで指が触れた（2本目が来れば指2本の操作、離せばタップとして扱う） */
  | { kind: 'touchWait'; pointerId: number; type: string; down: PointerEvent; start: Point }
  | { kind: 'lasso'; pointerId: number; type: string; polygon: Point[] }
  | { kind: 'move'; pointerId: number; type: string; start: Point; dx: number; dy: number }
  | { kind: 'pan'; pointerId: number; last: { x: number; y: number }; samples: { t: number; dx: number; dy: number }[] }

export class InkEngine {
  tool: Tool = 'pen'
  color = '#2c2c2a'
  penLevel: SizeLevel = 1
  markerLevel: SizeLevel = 1
  markerColor = '#ef9f27'
  eraserLevel: SizeLevel = 1

  private host: HTMLElement
  private opts: InkEngineOptions
  private committed: HTMLCanvasElement
  private live: HTMLCanvasElement
  private strokes: Stroke[] = []
  private items: InkItem[] = []
  private selectedItem: string | null = null
  /** テキストボックスを編集し始めたときの内容（編集が終わったら履歴に記録する） */
  private editBefore: InkContent | null = null
  private editingId: string | null = null
  /** 触れている指の画面座標（指2本の操作に使う。編集中の入力欄に触れている指も含む） */
  private touches = new Map<number, Point>()
  private history = new InkHistory<InkContent>()
  private gesture: Gesture | null = null
  private selection: Selection | null = null
  private lastPenTime = -Infinity
  private raf = 0
  private inertiaRaf = 0
  private committedDirty = true
  private view = { top: 0, height: 0, width: 0, dpr: 1 }
  private resizeObserver: ResizeObserver
  private boundScroller: HTMLElement | null = null
  private stylus: StylusTouch | null = null

  constructor(host: HTMLElement, opts: InkEngineOptions) {
    this.host = host
    this.opts = opts
    this.committed = document.createElement('canvas')
    this.live = document.createElement('canvas')
    for (const c of [this.committed, this.live]) {
      c.className = 'ink-canvas'
      host.appendChild(c)
    }
    host.classList.add('ink-surface')
    host.addEventListener('pointerdown', this.onDown)
    host.addEventListener('pointermove', this.onMove)
    host.addEventListener('pointerup', this.onUp)
    host.addEventListener('pointercancel', this.onCancel)
    // iPadOS は Pencil の動きをテキスト選択・Scribble として扱い、近くの文字にフォーカスを移すことがある（段階0で確認）
    host.addEventListener('touchstart', this.onTouch, { passive: false })
    host.addEventListener('touchmove', this.onTouch, { passive: false })
    host.addEventListener('touchend', this.onTouch)
    host.addEventListener('touchcancel', this.onTouch)
    document.addEventListener('selectstart', this.onSelectStart)
    window.addEventListener('resize', this.refresh)
    this.resizeObserver = new ResizeObserver(this.refresh)
    this.resizeObserver.observe(host)
    this.bindScroller()
    this.refresh()
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.stopInertia()
    this.resizeObserver.disconnect()
    this.host.removeEventListener('pointerdown', this.onDown)
    this.host.removeEventListener('pointermove', this.onMove)
    this.host.removeEventListener('pointerup', this.onUp)
    this.host.removeEventListener('pointercancel', this.onCancel)
    this.host.removeEventListener('touchstart', this.onTouch)
    this.host.removeEventListener('touchmove', this.onTouch)
    this.host.removeEventListener('touchend', this.onTouch)
    this.host.removeEventListener('touchcancel', this.onTouch)
    document.removeEventListener('selectstart', this.onSelectStart)
    window.removeEventListener('resize', this.refresh)
    this.boundScroller?.removeEventListener('scroll', this.refresh)
    this.committed.remove()
    this.live.remove()
  }

  // ---- 外から呼ぶ操作 ----

  setStrokes(strokes: Stroke[], items: InkItem[] = []) {
    this.strokes = strokes
    this.items = items
    this.selectedItem = null
    this.history.clear()
    this.setSelection(null)
    this.emitHistory()
    this.emitItems()
    this.invalidate()
  }

  getStrokes() {
    return this.strokes
  }

  getItems() {
    return this.items
  }

  setTool(tool: Tool) {
    if (tool !== this.tool) this.finishTextEdit()
    if (tool !== 'lasso') this.setSelection(null)
    if (tool !== 'select' && tool !== 'text') this.selectItem(null)
    this.tool = tool
    this.schedule()
  }

  undo() {
    const prev = this.history.undo(this.content)
    if (prev) this.applyHistory(prev)
  }

  redo() {
    const next = this.history.redo(this.content)
    if (next) this.applyHistory(next)
  }

  clearAll() {
    if (!this.strokes.length && !this.items.length) return
    this.commit({ strokes: [], items: [] })
  }

  deleteSelection() {
    if (!this.selection) return
    const ids = new Set(this.selection.ids)
    this.commit({ strokes: this.strokes.filter((s) => !ids.has(s.id)) })
    this.setSelection(null)
  }

  duplicateSelection() {
    if (!this.selection) return
    const ids = new Set(this.selection.ids)
    const offset = 20
    const copies = this.strokes.filter((s) => ids.has(s.id)).map((s) => ({ ...translateStroke(s, offset, offset), id: newStrokeId() }))
    this.commit({ strokes: [...this.strokes, ...copies] })
    this.selectIds(copies.map((c) => c.id))
  }

  recolorSelection(color: string) {
    if (!this.selection) return
    const ids = new Set(this.selection.ids)
    this.commit({ strokes: this.strokes.map((s) => (ids.has(s.id) ? { ...s, color } : s)) })
  }

  // ---- 置いたもの（画像・テキストボックス） ----

  /** 画像を置く（見えている範囲の中央）。置いた画像を選ぶ */
  addImage(src: string, width: number, height: number) {
    const item = newImageItem(src, width, height, this.visibleRect(), this.logicalWidth)
    this.commit({ items: [...this.items, item] })
    this.selectItem(item.id)
  }

  selectItem(id: string | null) {
    if (this.selectedItem === id) return
    this.selectedItem = id
    this.emitItems()
  }

  get selectedItemId() {
    return this.selectedItem
  }

  /** 選んでいるものを変える（文字の大きさ・色など）。履歴に記録する */
  updateItem(id: string, patch: Partial<InkItem>) {
    this.commit({ items: this.items.map((i) => (i.id === id ? ({ ...i, ...patch } as InkItem) : i)) })
  }

  /** 置く画像の保存場所 */
  get assets() {
    return this.opts.assets
  }

  /** 選んでいるテキストボックスの文字の大きさ・色を変える */
  styleSelectedText(style: { level?: SizeLevel; color?: string }) {
    const item = this.items.find((i) => i.id === this.selectedItem)
    if (item?.type !== 'text') return
    const level = style.level ?? item.level
    this.updateItem(item.id, { level, fontSize: fontSizeFor(level, this.logicalWidth), color: style.color ?? item.color })
  }

  /** 画面に見えている面積（px²）。画像を置く手書き面を選ぶのに使う */
  get visibleArea() {
    return this.view.height * this.view.width
  }

  deleteSelectedItem() {
    const id = this.selectedItem
    if (!id) return
    this.selectedItem = null
    this.commit({ items: this.items.filter((i) => i.id !== id) })
  }

  duplicateSelectedItem() {
    const item = this.items.find((i) => i.id === this.selectedItem)
    if (!item) return
    const offset = this.logicalWidth * 0.02
    const copy = { ...item, id: crypto.randomUUID(), x: item.x + offset, y: item.y + offset }
    this.commit({ items: [...this.items, copy] })
    this.selectItem(copy.id)
  }

  /** テキストボックスの編集を始める（呼ぶのは表示側） */
  beginTextEdit(id?: string) {
    this.editBefore ??= this.content
    if (id) this.editingId = id
  }

  /** 編集中のテキストボックスがあれば編集を終える（ツールの切り替え・ペンで触れたとき） */
  private finishTextEdit() {
    const id = this.editingId
    if (!id) return
    this.endTextEdit(id)
    this.opts.onEndEdit?.()
  }

  /** 入力中の文字を反映する（履歴には記録しない） */
  setItemText(id: string, text: string) {
    this.items = this.items.map((i) => (i.id === id && i.type === 'text' ? { ...i, text } : i))
    this.emitItems()
  }

  /** 編集を終える。空なら消す。変わっていれば1回の操作として履歴に記録する */
  endTextEdit(id: string) {
    const before = this.editBefore
    this.editBefore = null
    this.editingId = null
    const item = this.items.find((i) => i.id === id)
    if (item?.type === 'text' && !item.text.trim()) {
      this.items = this.items.filter((i) => i.id !== id)
      if (this.selectedItem === id) this.selectedItem = null
    }
    const changed = !before || before.items.length !== this.items.length || before.items.some((b, k) => b !== this.items[k])
    if (before && changed) {
      this.history.record(before)
      this.emitHistory()
      this.opts.onChange(this.strokes, this.items)
    }
    this.emitItems()
  }

  clearSelection() {
    this.setSelection(null)
  }

  /** 指で描いている途中の線を取り消す（2本指でピンチを始めたときなど） */
  cancelTouchGesture() {
    const g = this.gesture
    if (g && 'type' in g && g.type === 'touch') {
      this.gesture = null
      this.invalidate()
    }
  }

  /** ペンで描いている途中か（PDF・画像の表示側で、指のスクロールを止めるため） */
  get penActive() {
    return performance.now() - this.lastPenTime < PALM_MS
  }

  /** 大きさ・スクロール位置が変わったとき */
  refresh = () => {
    this.bindScroller()
    this.updateView()
    this.invalidate()
  }

  // ---- 内部 ----

  private bindScroller() {
    const s = this.opts.scroller()
    if (s === this.boundScroller) return
    this.boundScroller?.removeEventListener('scroll', this.refresh)
    s?.addEventListener('scroll', this.refresh, { passive: true })
    this.boundScroller = s
  }

  private get content(): InkContent {
    return { strokes: this.strokes, items: this.items }
  }

  private get logicalWidth() {
    return this.opts.logicalWidth?.() ?? 1000
  }

  private emitItems() {
    this.opts.onItems?.(this.items, this.selectedItem)
  }

  private applyHistory(c: InkContent) {
    this.strokes = c.strokes
    this.items = c.items
    if (this.selectedItem && !c.items.some((i) => i.id === this.selectedItem)) this.selectedItem = null
    this.setSelection(null)
    this.emitHistory()
    this.emitItems()
    this.invalidate()
    this.opts.onChange(c.strokes, c.items)
  }

  private commit(next: Partial<InkContent>) {
    this.history.record(this.content)
    if (next.strokes) this.strokes = next.strokes
    if (next.items) this.items = next.items
    this.emitHistory()
    if (next.items) this.emitItems()
    this.invalidate()
    this.opts.onChange(this.strokes, this.items)
  }

  private emitHistory() {
    this.opts.onHistory(this.history.canUndo, this.history.canRedo)
  }

  private setSelection(sel: Selection | null) {
    this.selection = sel
    this.opts.onSelection(sel)
    this.schedule()
  }

  private selectIds(ids: string[]) {
    const set = new Set(ids)
    const bounds = unionBounds(this.strokes.filter((s) => set.has(s.id)).map(cachedBounds))
    this.setSelection(bounds ? { ids, bounds } : null)
  }

  private get scale() {
    return this.opts.scale()
  }

  /** 手書き面のうち画面に見えている範囲（手書き面の上端からの px） */
  private updateView() {
    const hostRect = this.host.getBoundingClientRect()
    const scroller = this.opts.scroller()
    const viewRect = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight }
    const top = Math.max(hostRect.top, viewRect.top, 0)
    const bottom = Math.min(hostRect.bottom, viewRect.bottom, window.innerHeight)
    const dpr = window.devicePixelRatio || 1
    const height = Math.max(0, Math.ceil(bottom - top))
    const width = Math.ceil(hostRect.width)
    this.view = { top: Math.max(0, Math.floor(top - hostRect.top)), height, width, dpr }
    for (const c of [this.committed, this.live]) {
      const w = Math.round(width * dpr)
      const h = Math.round(height * dpr)
      if (c.width !== w || c.height !== h) {
        c.width = w
        c.height = h
      }
      c.style.top = `${this.view.top}px`
      c.style.width = `${width}px`
      c.style.height = `${height}px`
    }
  }

  private ctx(c: HTMLCanvasElement) {
    const ctx = c.getContext('2d')!
    const { dpr, top } = this.view
    const s = this.scale
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.setTransform(dpr * s, 0, 0, dpr * s, 0, -top * dpr)
    return ctx
  }

  /** 見えている範囲（論理座標） */
  private visibleRect(): Rect {
    const s = this.scale
    return { x: 0, y: this.view.top / s, width: this.view.width / s, height: this.view.height / s }
  }

  private invalidate() {
    this.committedDirty = true
    this.schedule()
  }

  private schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame)
  }

  private toLogical(e: PointerEvent): Point {
    const r = this.host.getBoundingClientRect()
    const s = this.scale
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s }
  }

  private pressure(e: PointerEvent) {
    return e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5
  }

  private canDraw(e: PointerEvent): boolean {
    if (this.opts.readOnly()) return false
    if (e.pointerType === 'pen') return true
    if (e.pointerType === 'mouse') return e.button === 0
    if (!this.opts.fingerDraw()) return false
    // 手のひら対策: ペンを使っている間と、離してから 0.5 秒は指で描かない
    return performance.now() - this.lastPenTime >= PALM_MS && this.gesture?.kind !== 'draw'
  }

  private capture(pointerId: number) {
    if (pointerId === TOUCH_FALLBACK_ID) return
    try {
      this.host.setPointerCapture(pointerId)
    } catch {
      // 取り込めなくても描画は続けられる
    }
  }

  private onDown = (e: PointerEvent) => {
    this.stopInertia()
    if (e.pointerType === 'pen' && e.pointerId !== TOUCH_FALLBACK_ID) {
      if (this.stylus) this.stylus.pointerSeen = true
      // touch イベントから描き始めている線は、そのまま touch イベントで続ける
      if (this.gesture?.pointerId === TOUCH_FALLBACK_ID) return
    }
    if (e.pointerType === 'pen') {
      this.lastPenTime = performance.now()
      // ペンが触れたら、指で描いている途中の線は取り消す
      if (this.gesture && 'type' in this.gesture && this.gesture.type === 'touch') {
        this.gesture = null
        this.schedule()
      }
      if (this.gesture?.kind === 'pan') this.gesture = null
    }
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this.touches.size >= 2 && this.startTwoFinger(e, true)) return
      // 編集中に文字ツールで触れた指は、すぐには新しいテキストボックスを作らない（2本目の指で動かすことがあるため）
      if (!this.gesture && this.editingId && this.tool === 'text') {
        this.gesture = { kind: 'touchWait', pointerId: e.pointerId, type: 'touch', down: e, start: { x: e.clientX, y: e.clientY } }
        return
      }
    }
    if (this.gesture) return
    // 指はスクロールに使うことがあるため、編集はペン・マウスで触れたときだけ終える（指で別の所に置くときは onItemDown で終える）
    if (e.pointerType !== 'touch') this.finishTextEdit()

    if ((this.tool === 'select' || this.tool === 'text') && this.onItemDown(e)) return
    if (this.tool !== 'select' && this.tool !== 'text') this.selectItem(null)

    if (this.canDraw(e) && this.tool !== 'select' && this.tool !== 'text') {
      this.capture(e.pointerId)
      e.preventDefault()
      const p = this.toLogical(e)
      if (this.tool === 'eraser') {
        this.gesture = { kind: 'erase', pointerId: e.pointerId, type: e.pointerType, before: this.content, last: null, changed: false }
        this.eraseTo(p)
      } else if (this.tool === 'lasso') {
        const b = this.selection?.bounds
        if (b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height) {
          this.gesture = { kind: 'move', pointerId: e.pointerId, type: e.pointerType, start: p, dx: 0, dy: 0 }
          this.invalidate()
        } else {
          this.setSelection(null)
          this.gesture = { kind: 'lasso', pointerId: e.pointerId, type: e.pointerType, polygon: [p] }
        }
      } else {
        const tool = this.tool as InkTool
        const marker = tool === 'marker'
        const now = performance.now()
        this.gesture = {
          kind: 'draw',
          pointerId: e.pointerId,
          type: e.pointerType,
          start: now,
          anchor: p,
          lastMoveAt: now,
          flashUntil: 0,
          stroke: {
            id: newStrokeId(),
            tool,
            color: marker ? this.markerColor : this.color,
            size: marker ? MARKER_SIZES[this.markerLevel] : PEN_SIZES[this.penLevel],
            opacity: marker ? MARKER_OPACITY : 1,
            points: [p.x, p.y, this.pressure(e), 0],
          },
        }
      }
      this.schedule()
    } else if (e.pointerType === 'touch' && this.opts.touchPan !== false) {
      // 指はスクロール（方式A: 自前スクロール＋弱い慣性）
      this.capture(e.pointerId)
      this.gesture = { kind: 'pan', pointerId: e.pointerId, last: { x: e.clientX, y: e.clientY }, samples: [] }
    }
  }

  /** 選択・文字のツールでの pointerdown。処理したら true */
  private onItemDown(e: PointerEvent): boolean {
    if (this.opts.readOnly()) return false
    // 指は、ペンを使った直後（手のひら）でなければ使える
    if (e.pointerType === 'touch' && performance.now() - this.lastPenTime < PALM_MS) return true
    if (e.pointerType === 'mouse' && e.button !== 0) return false
    const p = this.toLogical(e)
    const hit = this.opts.hitTestItem?.(e.clientX, e.clientY) ?? null
    const item = hit ? this.items.find((i) => i.id === hit.id) : undefined
    if (this.tool === 'text' && (!item || item.type === 'text')) {
      e.preventDefault()
      this.finishTextEdit()
      if (item) {
        this.selectItem(item.id)
        this.opts.onEditText?.(item.id)
        return true
      }
      // 何もない所に触れたら、新しいテキストボックスを作って編集を始める
      this.beginTextEdit()
      const style = this.opts.textStyle?.() ?? { level: 1 as SizeLevel, color: this.color }
      const t = newTextItem(p.x, p.y, this.logicalWidth, style.level, style.color)
      this.items = [...this.items, t]
      this.selectedItem = t.id
      this.emitItems()
      this.opts.onEditText?.(t.id)
      return true
    }
    if (!item) {
      this.selectItem(null)
      // 指で何もない所に触れたら、スクロールに使う
      return false
    }
    e.preventDefault()
    this.capture(e.pointerId)
    const wasSelected = this.selectedItem === item.id
    this.selectItem(item.id)
    const orig = rectOf(item)
    const attached = this.attachedStrokes(item)
    if (hit?.handle && wasSelected) {
      this.gesture = { kind: 'itemResize', pointerId: e.pointerId, type: e.pointerType, id: item.id, start: p, orig, before: this.content, attached }
    } else {
      this.gesture = { kind: 'itemMove', pointerId: e.pointerId, type: e.pointerType, id: item.id, start: p, orig, moved: false, wasSelected, before: this.content, attached }
    }
    // PDF・画像の表示側（ZoomViewport）にスクロール・ピンチをさせない
    if (e.pointerType === 'touch') e.stopPropagation()
    return true
  }

  /** 画像の上に描いた線（点の半分以上が画像の中にある線）。画像と一緒に動かす */
  private attachedStrokes(item: InkItem): Stroke[] {
    return item.type === 'image' ? strokesInRect(this.strokes, { x: item.x, y: item.y, width: item.w, height: item.h }) : []
  }

  /** 置いたものを next の位置・大きさにし、一緒に動かす線も合わせる */
  private placeItem(id: string, orig: ItemRect, next: ItemRect, attached: Stroke[]) {
    this.items = this.items.map((i) => (i.id !== id ? i : i.type === 'image' ? { ...i, ...next } : { ...i, x: next.x, y: next.y, w: next.w }))
    if (attached.length) {
      const k = orig.w ? next.w / orig.w : 1
      const moved = new Map(attached.map((s) => [s.id, transformStroke(s, orig.x, orig.y, next.x, next.y, k)]))
      this.strokes = this.strokes.map((s) => moved.get(s.id) ?? s)
      this.invalidate()
    }
    this.emitItems()
  }

  /**
   * 2本目の指が触れたとき、どちらかの指が置いたものに触れていれば（テキストボックスの編集中は常に）、
   * 指2本でそれを動かす操作にする（画像はピンチで拡大縮小）。どのツールでも使える
   */
  private startTwoFinger(e: PointerEvent, onHost: boolean): boolean {
    if (this.opts.readOnly() || performance.now() - this.lastPenTime < PALM_MS) return false
    const ids = [...this.touches.keys()].slice(-2)
    if (ids.length < 2) return false
    const [pa, pb] = ids.map((id) => this.touches.get(id)!)
    const g = this.gesture
    let item: InkItem | undefined
    if (this.editingId) item = this.items.find((i) => i.id === this.editingId)
    else if (g && (g.kind === 'itemMove' || g.kind === 'itemResize') && g.type === 'touch') item = this.items.find((i) => i.id === g.id)
    else {
      const hit = this.opts.hitTestItem?.(pa.x, pa.y) ?? this.opts.hitTestItem?.(pb.x, pb.y) ?? null
      item = hit ? this.items.find((i) => i.id === hit.id) : undefined
    }
    if (!item) return false
    // 指1本で始めていた操作はやめる（描いていた線は捨て、消した線は戻す）
    let before = this.content
    let attached: Stroke[] | null = null
    if (g && (g.kind === 'itemMove' || g.kind === 'itemResize')) {
      // 指1本で動かした分はそのままにして、続けて動かす
      before = g.before
      const ids = new Set(g.attached.map((s) => s.id))
      attached = this.strokes.filter((s) => ids.has(s.id))
    } else if (g?.kind === 'erase' && g.changed) {
      this.strokes = g.before.strokes
      before = g.before
    }
    const current = item
    this.stopInertia()
    e.preventDefault()
    e.stopPropagation()
    if (onHost) this.capture(e.pointerId)
    // PDF・画像の表示側（ZoomViewport）に、始めていたスクロール・ピンチをやめさせる
    this.host.dispatchEvent(new CustomEvent('ink-item-gesture', { bubbles: true }))
    this.gesture = { kind: 'itemPinch', pointerId: ids[0], second: ids[1], type: 'touch', id: current.id, a0: pa, b0: pb, a: pa, b: pb, orig: rectOf(current), before, attached: attached ?? this.attachedStrokes(current) }
    this.emitItems()
    this.invalidate()
    return true
  }

  private updateItemPinch(g: Extract<Gesture, { kind: 'itemPinch' }>) {
    const r = this.host.getBoundingClientRect()
    const mid = (p: Point, q: Point) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })
    const m0 = mid(g.a0, g.b0)
    const m = mid(g.a, g.b)
    const d0 = Math.max(10, Math.hypot(g.a0.x - g.b0.x, g.a0.y - g.b0.y))
    // 指2本の中点を基準に拡大縮小し、中点の移動に合わせて動かす（論理座標）
    const c0 = { x: (m0.x - r.left) / this.scale, y: (m0.y - r.top) / this.scale }
    const dx = (m.x - m0.x) / this.scale
    const dy = (m.y - m0.y) / this.scale
    const item = this.items.find((i) => i.id === g.id)
    if (!item) return
    if (item.type !== 'image') {
      this.placeItem(g.id, g.orig, { ...g.orig, x: g.orig.x + dx, y: g.orig.y + dy }, g.attached)
      return
    }
    const min = 48 / this.scale
    const s = Math.max(min / g.orig.w, Math.hypot(g.a.x - g.b.x, g.a.y - g.b.y) / d0)
    this.placeItem(g.id, g.orig, { x: c0.x + (g.orig.x - c0.x) * s + dx, y: c0.y + (g.orig.y - c0.y) * s + dy, w: g.orig.w * s, h: g.orig.h * s }, g.attached)
  }

  private endItemPinch(g: Extract<Gesture, { kind: 'itemPinch' }>) {
    this.gesture = null
    // 編集中のテキストボックスは、編集を終えたときに文字の変更とまとめて履歴に記録する
    if (g.id === this.editingId) return
    this.history.record(g.before)
    this.emitHistory()
    this.opts.onChange(this.strokes, this.items)
  }

  /**
   * 手書き面の外（編集中の入力欄）に触れている指を知らせる。
   * その指と手書き面の指の2本で、テキストボックスを動かせるようにする
   */
  externalTouch(e: PointerEvent) {
    if (e.pointerType !== 'touch') return
    if (e.type === 'pointerdown') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this.touches.size >= 2) {
        // 文字ツールで待っていた指（タップ扱い）は取りやめる
        if (this.gesture?.kind === 'touchWait') this.gesture = null
        this.startTwoFinger(e, false)
      }
    } else if (e.type === 'pointermove') this.onMove(e)
    else if (e.type === 'pointerup') this.onUp(e)
    else this.onCancel(e)
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'pen') this.lastPenTime = performance.now()
    if (e.pointerType === 'touch' && this.touches.has(e.pointerId)) this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = this.gesture
    if (g?.kind === 'itemPinch') {
      if (e.pointerId === g.pointerId) g.a = { x: e.clientX, y: e.clientY }
      else if (e.pointerId === g.second) g.b = { x: e.clientX, y: e.clientY }
      else return
      this.updateItemPinch(g)
      return
    }
    if (!g || g.pointerId !== e.pointerId) return
    if (g.kind === 'touchWait') {
      // 指1本のまま動かしたら、スクロールにする
      if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) > 8) {
        this.gesture = this.opts.touchPan !== false ? { kind: 'pan', pointerId: e.pointerId, last: { x: e.clientX, y: e.clientY }, samples: [] } : null
      }
      return
    }
    if (g.kind === 'itemMove' || g.kind === 'itemResize') {
      const p = this.toLogical(e)
      const dx = p.x - g.start.x
      const dy = p.y - g.start.y
      if (g.kind === 'itemMove') {
        if (Math.hypot(dx, dy) * this.scale > 4) g.moved = true
        if (g.moved) this.placeItem(g.id, g.orig, { ...g.orig, x: g.orig.x + dx, y: g.orig.y + dy }, g.attached)
      } else {
        const w = Math.max(48 / this.scale, g.orig.w + dx)
        this.placeItem(g.id, g.orig, { ...g.orig, w, h: g.orig.w ? (w * g.orig.h) / g.orig.w : g.orig.h }, g.attached)
      }
      return
    }
    const events = e.getCoalescedEvents?.() ?? []
    const list = events.length ? events : [e]

    switch (g.kind) {
      case 'pan': {
        const dx = e.clientX - g.last.x
        const dy = e.clientY - g.last.y
        g.last = { x: e.clientX, y: e.clientY }
        this.panBy(dy)
        const now = performance.now()
        g.samples.push({ t: now, dx, dy })
        g.samples = g.samples.filter((s) => now - s.t < 100)
        return
      }
      case 'draw': {
        const now = performance.now()
        if (g.stroke.isLine) {
          // 直線化の後は、離すまで終点をペンの位置に追従させる
          const p = this.toLogical(e)
          const pts = g.stroke.points
          g.stroke = { ...g.stroke, points: [pts[0], pts[1], pts[2], pts[3], p.x, p.y, pts[6], now - g.start] }
        } else {
          const pts = g.stroke.points
          for (const ev of list) {
            const p = this.toLogical(ev)
            pts.push(p.x, p.y, this.pressure(ev), Math.round(now - g.start))
          }
          const p = this.toLogical(e)
          if (Math.hypot(p.x - g.anchor.x, p.y - g.anchor.y) * this.scale > HOLD_RADIUS_PX) {
            g.anchor = p
            g.lastMoveAt = now
          }
          this.checkBottom(p.y)
        }
        break
      }
      case 'erase':
        for (const ev of list) this.eraseTo(this.toLogical(ev))
        break
      case 'lasso':
        for (const ev of list) g.polygon.push(this.toLogical(ev))
        break
      case 'move': {
        const p = this.toLogical(e)
        g.dx = p.x - g.start.x
        g.dy = p.y - g.start.y
        break
      }
    }
    this.schedule()
  }

  private onUp = (e: PointerEvent) => {
    this.touches.delete(e.pointerId)
    const g = this.gesture
    // 指2本の操作は、どちらかの指を離したら終える（残った指では動かさない）
    if (g?.kind === 'itemPinch' && (e.pointerId === g.pointerId || e.pointerId === g.second)) {
      this.endItemPinch(g)
      return
    }
    if (!g || g.pointerId !== e.pointerId) return
    this.gesture = null
    switch (g.kind) {
      case 'touchWait': {
        // 動かさずに離した: 文字ツールのタップとして扱う（新しいテキストボックス、または別のテキストボックスの編集）
        this.onItemDown(g.down)
        const next = this.gesture as Gesture | null
        if (next?.pointerId === g.pointerId) this.gesture = null
        return
      }
      case 'pan':
        this.startInertia(g.samples)
        return
      case 'draw':
        this.commit({ strokes: [...this.strokes, g.stroke] })
        break
      case 'erase':
        if (g.changed) {
          this.history.record(g.before)
          this.emitHistory()
          this.opts.onChange(this.strokes, this.items)
        }
        break
      case 'itemMove': {
        if (g.moved) {
          this.history.record(g.before)
          this.emitHistory()
          this.opts.onChange(this.strokes, this.items)
        } else {
          // 選んでいるテキストボックスにもう一度触れたら、編集を始める
          const item = this.items.find((i) => i.id === g.id)
          if (g.wasSelected && item?.type === 'text') this.opts.onEditText?.(item.id)
        }
        return
      }
      case 'itemResize':
        this.history.record(g.before)
        this.emitHistory()
        this.opts.onChange(this.strokes, this.items)
        return
      case 'lasso': {
        const ids = lassoSelect(this.strokes, g.polygon)
        if (ids.length) this.selectIds(ids)
        break
      }
      case 'move': {
        if (Math.hypot(g.dx, g.dy) * this.scale < 1 || !this.selection) break
        const ids = new Set(this.selection.ids)
        this.commit({ strokes: this.strokes.map((s) => (ids.has(s.id) ? translateStroke(s, g.dx, g.dy) : s)) })
        this.selectIds([...ids])
        break
      }
    }
    this.invalidate()
  }

  private onCancel = (e: PointerEvent) => {
    this.touches.delete(e.pointerId)
    const g = this.gesture
    if (g?.kind === 'itemPinch' && (e.pointerId === g.pointerId || e.pointerId === g.second)) {
      this.endItemPinch(g)
      return
    }
    if (!g || g.pointerId !== e.pointerId) return
    this.gesture = null
    // 消しゴム・移動の途中で取り消されたら、そこまでの分は残して履歴に記録する
    if ((g.kind === 'erase' && g.changed) || (g.kind === 'itemMove' && g.moved) || g.kind === 'itemResize') {
      this.history.record(g.before)
      this.emitHistory()
      this.opts.onChange(this.strokes, this.items)
    }
    this.invalidate()
  }

  private onTouch = (e: TouchEvent) => {
    // ペンの touch イベントは常に止めて、OS のテキスト選択・Scribble が動かないようにする。指は自前でスクロールするため止める
    if (e.cancelable && (e.type === 'touchstart' || e.type === 'touchmove')) e.preventDefault()

    // 保険: iPadOS が Pencil の pointerdown を渡さないことがある（ボタンをタップした直後など）。
    // そのときは touch イベントから線を描く
    const t = stylusIn(e.changedTouches)
    if (!t) return
    if (e.type === 'touchstart') {
      if (this.stylus) window.clearTimeout(this.stylus.timer)
      const stylus: StylusTouch = { id: t.identifier, pointerSeen: false, buffer: [t], timer: 0 }
      stylus.timer = window.setTimeout(() => {
        if (this.stylus !== stylus || stylus.pointerSeen || this.gesture) return
        const [first, ...rest] = stylus.buffer
        this.onDown(touchAsPointer(first))
        for (const r of rest) this.onMove(touchAsPointer(r))
        stylus.buffer = []
      }, FALLBACK_WAIT_MS)
      this.stylus = stylus
    } else if (this.stylus && t.identifier === this.stylus.id) {
      if (e.type === 'touchmove') {
        if (this.gesture?.pointerId === TOUCH_FALLBACK_ID) this.onMove(touchAsPointer(t))
        else if (!this.stylus.pointerSeen) this.stylus.buffer.push(t)
      } else {
        window.clearTimeout(this.stylus.timer)
        if (this.gesture?.pointerId === TOUCH_FALLBACK_ID) this.onUp(touchAsPointer(t))
        this.stylus = null
      }
    }
  }

  private onSelectStart = (e: Event) => {
    if (this.gesture) e.preventDefault()
  }

  private eraseTo(p: Point) {
    const g = this.gesture
    if (g?.kind !== 'erase') return
    const radius = ERASER_RADII[this.eraserLevel]
    const next = eraseStrokes(this.strokes, eraserPath(g.last, p, radius), radius)
    g.last = p
    if (next) {
      this.strokes = next
      g.changed = true
      this.committedDirty = true
    }
  }

  private checkBottom(y: number) {
    const height = this.host.clientHeight / this.scale
    if (y > height - GROW_MARGIN) this.opts.onReachBottom?.(y)
  }

  private panBy(dy: number) {
    const s = this.opts.scroller()
    if (s) s.scrollTop -= dy
  }

  private startInertia(samples: { t: number; dy: number }[]) {
    const now = performance.now()
    const recent = samples.filter((s) => now - s.t < 100)
    if (recent.length < 2) return
    const dt = Math.max(16, now - recent[0].t)
    let vy = Math.max(-INERTIA_MAX_SPEED, Math.min(INERTIA_MAX_SPEED, recent.reduce((s, p) => s + p.dy, 0) / dt))
    let last = now
    const step = (t: number) => {
      const elapsed = t - last
      last = t
      vy *= Math.pow(INERTIA_FRICTION, elapsed / 16)
      if (Math.abs(vy) < INERTIA_MIN_SPEED) {
        this.inertiaRaf = 0
        return
      }
      this.panBy(vy * elapsed)
      this.inertiaRaf = requestAnimationFrame(step)
    }
    this.inertiaRaf = requestAnimationFrame(step)
  }

  private stopInertia() {
    cancelAnimationFrame(this.inertiaRaf)
    this.inertiaRaf = 0
  }

  private frame = () => {
    this.raf = 0
    const now = performance.now()
    const g = this.gesture
    const moving = g?.kind === 'move' ? g : null
    const movingIds = moving && this.selection ? new Set(this.selection.ids) : null
    const visible = this.visibleRect()

    if (this.committedDirty || moving) {
      this.committedDirty = false
      const ctx = this.ctx(this.committed)
      for (const s of this.strokes) {
        if (movingIds?.has(s.id)) continue
        if (rectsIntersect(cachedBounds(s), visible)) drawStroke(ctx, s)
      }
    }

    const ctx = this.ctx(this.live)
    const s = this.scale
    if (g?.kind === 'draw') {
      if (!g.stroke.isLine && shouldSnapLine(g.stroke.points, g.lastMoveAt, now, this.opts.holdMs(), MIN_LINE_PX / s)) {
        g.stroke = { ...g.stroke, points: toLine(g.stroke.points), isLine: true }
        g.flashUntil = now + 150
      }
      drawStroke(ctx, g.stroke, strokePath(g.stroke, false), now < g.flashUntil ? 0.4 : 1)
    } else if (g?.kind === 'erase' && g.last) {
      ctx.beginPath()
      ctx.arc(g.last.x, g.last.y, ERASER_RADII[this.eraserLevel], 0, Math.PI * 2)
      ctx.lineWidth = 1 / s
      ctx.strokeStyle = '#888780'
      ctx.stroke()
    } else if (g?.kind === 'lasso' && g.polygon.length > 1) {
      ctx.beginPath()
      g.polygon.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.setLineDash([6 / s, 4 / s])
      ctx.lineWidth = 1.5 / s
      ctx.strokeStyle = '#378add'
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (movingIds && moving) {
      ctx.save()
      ctx.translate(moving.dx, moving.dy)
      for (const st of this.strokes) if (movingIds.has(st.id)) drawStroke(ctx, st, cachedPath(st))
      ctx.restore()
    }
    if (this.selection) {
      const b = this.selection.bounds
      const dx = moving?.dx ?? 0
      const dy = moving?.dy ?? 0
      ctx.setLineDash([6 / s, 4 / s])
      ctx.lineWidth = 1.5 / s
      ctx.strokeStyle = '#378add'
      ctx.strokeRect(b.x + dx - 4 / s, b.y + dy - 4 / s, b.width + 8 / s, b.height + 8 / s)
      ctx.setLineDash([])
    }

    // 描いている間は、ペンが止まっていても直線化の判定を続ける
    if (g && g.kind !== 'pan') this.schedule()
  }
}

