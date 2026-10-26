import { eraserPath, eraseStrokes, lassoSelect, shouldSnapLine, toLine, translateStroke } from './geometry'
import { InkHistory } from './history'
import {
  ERASER_RADII, MARKER_OPACITY, MARKER_SIZES, newStrokeId, PEN_SIZES, rectsIntersect, unionBounds,
  type InkTool, type Point, type Rect, type SizeLevel, type Stroke, type Tool,
} from './model'
import { cachedBounds, cachedPath, drawStroke, strokePath } from './render'

// 手書き面（内部仕様書 6.1〜6.7）。React に依存しない。
// 座標は論理座標（手書きブロックは横幅1000）。画面には scale 倍して表示する。
// Canvas は手書き面のうち画面に見えている部分だけを覆い、スクロールに合わせて描き直す（縦に長いノートでも Canvas の上限を超えない）

export type Selection = { ids: string[]; bounds: Rect }

export type InkEngineOptions = {
  /** 論理座標1あたりの画面上の px */
  scale: () => number
  /** スクロールする親要素（指のスクロールと、見えている範囲の計算に使う） */
  scroller: () => HTMLElement | null
  holdMs: () => number
  fingerDraw: () => boolean
  readOnly: () => boolean
  /** 確定した変更（保存する） */
  onChange: (strokes: Stroke[]) => void
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

type StylusTouch = { id: number; pointerSeen: boolean; buffer: Touch[]; timer: number }

// touch イベントを Pointer Events の代わりに使うための、最低限の形
function touchAsPointer(t: Touch): PointerEvent {
  const force = t.force > 0 ? Math.min(1, t.force) : 0.5
  return { pointerId: TOUCH_FALLBACK_ID, pointerType: 'pen', clientX: t.clientX, clientY: t.clientY, pressure: force, button: 0, preventDefault() {} } as unknown as PointerEvent
}

const stylusIn = (list: TouchList) => [...list].find((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')

type Gesture =
  | { kind: 'draw'; pointerId: number; type: string; stroke: Stroke; start: number; anchor: Point; lastMoveAt: number; flashUntil: number }
  | { kind: 'erase'; pointerId: number; type: string; before: Stroke[]; last: Point | null; changed: boolean }
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
  private history = new InkHistory()
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

  setStrokes(strokes: Stroke[]) {
    this.strokes = strokes
    this.history.clear()
    this.setSelection(null)
    this.emitHistory()
    this.invalidate()
  }

  getStrokes() {
    return this.strokes
  }

  setTool(tool: Tool) {
    if (tool !== 'lasso') this.setSelection(null)
    this.tool = tool
    this.schedule()
  }

  undo() {
    const prev = this.history.undo(this.strokes)
    if (prev) this.applyHistory(prev)
  }

  redo() {
    const next = this.history.redo(this.strokes)
    if (next) this.applyHistory(next)
  }

  clearAll() {
    if (!this.strokes.length) return
    this.commit([])
  }

  deleteSelection() {
    if (!this.selection) return
    const ids = new Set(this.selection.ids)
    this.commit(this.strokes.filter((s) => !ids.has(s.id)))
    this.setSelection(null)
  }

  duplicateSelection() {
    if (!this.selection) return
    const ids = new Set(this.selection.ids)
    const offset = 20
    const copies = this.strokes.filter((s) => ids.has(s.id)).map((s) => ({ ...translateStroke(s, offset, offset), id: newStrokeId() }))
    this.commit([...this.strokes, ...copies])
    this.selectIds(copies.map((c) => c.id))
  }

  recolorSelection(color: string) {
    if (!this.selection) return
    const ids = new Set(this.selection.ids)
    this.commit(this.strokes.map((s) => (ids.has(s.id) ? { ...s, color } : s)))
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

  private applyHistory(strokes: Stroke[]) {
    this.strokes = strokes
    this.setSelection(null)
    this.emitHistory()
    this.invalidate()
    this.opts.onChange(strokes)
  }

  private commit(next: Stroke[]) {
    this.history.record(this.strokes)
    this.strokes = next
    this.emitHistory()
    this.invalidate()
    this.opts.onChange(next)
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
    if (this.gesture) return

    if (this.canDraw(e)) {
      this.capture(e.pointerId)
      e.preventDefault()
      const p = this.toLogical(e)
      if (this.tool === 'eraser') {
        this.gesture = { kind: 'erase', pointerId: e.pointerId, type: e.pointerType, before: this.strokes, last: null, changed: false }
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

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'pen') this.lastPenTime = performance.now()
    const g = this.gesture
    if (!g || g.pointerId !== e.pointerId) return
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
    const g = this.gesture
    if (!g || g.pointerId !== e.pointerId) return
    this.gesture = null
    switch (g.kind) {
      case 'pan':
        this.startInertia(g.samples)
        return
      case 'draw':
        this.commit([...this.strokes, g.stroke])
        break
      case 'erase':
        if (g.changed) {
          this.history.record(g.before)
          this.emitHistory()
          this.opts.onChange(this.strokes)
        }
        break
      case 'lasso': {
        const ids = lassoSelect(this.strokes, g.polygon)
        if (ids.length) this.selectIds(ids)
        break
      }
      case 'move': {
        if (Math.hypot(g.dx, g.dy) * this.scale < 1 || !this.selection) break
        const ids = new Set(this.selection.ids)
        this.commit(this.strokes.map((s) => (ids.has(s.id) ? translateStroke(s, g.dx, g.dy) : s)))
        this.selectIds([...ids])
        break
      }
    }
    this.invalidate()
  }

  private onCancel = (e: PointerEvent) => {
    const g = this.gesture
    if (!g || g.pointerId !== e.pointerId) return
    this.gesture = null
    // 消しゴムの途中で取り消されたら、消した分は残して履歴に記録する
    if (g.kind === 'erase' && g.changed) {
      this.history.record(g.before)
      this.emitHistory()
      this.opts.onChange(this.strokes)
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

