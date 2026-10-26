import { getStroke } from 'perfect-freehand'

// 段階0の手書き試作。描き心地・手のひら対策・直線化・指スクロールを検証する（本実装は段階2で作り直す）

export type Tool = 'pen' | 'marker' | 'eraser'
type StrokeTool = Exclude<Tool, 'eraser'>

type Point = [x: number, y: number, pressure: number]

type Stroke = {
  tool: StrokeTool
  color: string
  points: Point[]
  simulatePressure: boolean
  isLine: boolean
}

export type InkStats = {
  pointerType: string
  pressure: number
  eventsPerSec: number
  coalescedAvg: number
  latencyMs: number
  cancels: number
  palmRejected: number
}

export type InkPadOptions = {
  holdMs: () => number
  fingerDraw: () => boolean
  /** 'manual': 指の移動を onPan で通知する / 'native': 指はブラウザに任せる */
  touchMode: () => 'manual' | 'native'
  onPan?: (dx: number, dy: number) => void
  onStats?: (s: InkStats) => void
  onSnap?: () => void
}

const PALM_MS = 500
const HOLD_RADIUS = 3
const MIN_LINE_LENGTH = 20
const MAX_HISTORY = 100
const ERASER_RADIUS = 12
const DENSIFY_STEP = 2

const strokeSize = (s: Stroke) => (s.tool === 'marker' ? 18 : 4)

// 点の間隔が step 以下になるよう補間する（2点だけの直線も途中で消せるようにする）
function densify(points: Point[], step: number): Point[] {
  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const [x0, y0, p0] = points[i - 1]
    const [x1, y1, p1] = points[i]
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step)
    for (let k = 1; k <= n; k++) {
      const t = k / n
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p0 + (p1 - p0) * t])
    }
  }
  return out
}

/** 消しゴムの円にかかった部分を取り除き、残りを別々の線に分ける。かからなければ null */
function eraseFromStroke(stroke: Stroke, x: number, y: number, r: number): Stroke[] | null {
  const reach = r + strokeSize(stroke) / 2
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [px, py] of stroke.points) {
    minX = Math.min(minX, px); maxX = Math.max(maxX, px)
    minY = Math.min(minY, py); maxY = Math.max(maxY, py)
  }
  if (x < minX - reach || x > maxX + reach || y < minY - reach || y > maxY + reach) return null

  const pts = densify(stroke.points, DENSIFY_STEP)
  const hit = pts.map(([px, py]) => Math.hypot(px - x, py - y) <= reach)
  if (!hit.includes(true)) return null

  const pieces: Stroke[] = []
  let run: Point[] = []
  const flush = () => {
    if (run.length >= 2) pieces.push({ ...stroke, points: run, isLine: false, simulatePressure: false })
    run = []
  }
  pts.forEach((p, i) => (hit[i] ? flush() : run.push(p)))
  flush()
  return pieces
}

function outlinePath(stroke: Stroke): Path2D {
  const size = strokeSize(stroke)
  const pts = stroke.isLine && stroke.points.length >= 2
    ? [stroke.points[0], stroke.points[stroke.points.length - 1]]
    : stroke.points
  const outline = getStroke(pts, {
    size,
    thinning: stroke.tool === 'marker' ? 0 : 0.6,
    smoothing: 0.5,
    streamline: stroke.isLine ? 0 : 0.4,
    simulatePressure: stroke.simulatePressure && !stroke.isLine,
    last: true,
  })
  const path = new Path2D()
  if (!outline.length) return path
  path.moveTo(outline[0][0], outline[0][1])
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1]
    const [x1, y1] = outline[i]
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  path.closePath()
  return path
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, flash = false) {
  ctx.save()
  ctx.fillStyle = stroke.color
  ctx.globalAlpha = (stroke.tool === 'marker' ? 0.35 : 1) * (flash ? 0.4 : 1)
  ctx.fill(outlinePath(stroke))
  ctx.restore()
}

export class InkPad {
  tool: Tool = 'pen'
  color = '#2c2c2a'

  private committed: HTMLCanvasElement
  private live: HTMLCanvasElement
  private strokes: Stroke[] = []
  // 元に戻す用: 各操作の直前の線の一覧
  private history: Stroke[][] = []
  private current: Stroke | null = null
  private erasePointer = -1
  private eraseChanged = false
  private eraserPos: { x: number; y: number } | null = null
  private committedDirty = false
  private currentPointer = -1
  private currentType = ''
  private anchor = { x: 0, y: 0, t: 0 }
  private flashUntil = 0
  private lastPenTime = -Infinity
  private panPointer = -1
  private panLast = { x: 0, y: 0 }
  private raf = 0
  private dpr = 1
  private resizeObserver: ResizeObserver
  private stats: InkStats = { pointerType: '-', pressure: 0, eventsPerSec: 0, coalescedAvg: 0, latencyMs: 0, cancels: 0, palmRejected: 0 }
  private eventTimes: number[] = []
  private coalescedCounts: number[] = []
  private latencies: number[] = []
  private pendingEventTime = 0

  private container: HTMLElement
  private opts: InkPadOptions

  constructor(container: HTMLElement, opts: InkPadOptions) {
    this.container = container
    this.opts = opts
    this.committed = document.createElement('canvas')
    this.live = document.createElement('canvas')
    for (const c of [this.committed, this.live]) {
      Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
      container.appendChild(c)
    }
    container.style.position = 'relative'
    for (const prop of ['user-select', '-webkit-user-select', '-webkit-touch-callout']) container.style.setProperty(prop, 'none')
    this.applyTouchAction()
    container.addEventListener('pointerdown', this.onDown)
    container.addEventListener('pointermove', this.onMove)
    container.addEventListener('pointerup', this.onUp)
    container.addEventListener('pointercancel', this.onCancel)
    // iPadOSは Pencil の動きをテキスト選択・Scribble として解釈し、近くの文字にフォーカスを移すことがある。
    // touch イベントを止めてOS標準のジェスチャーを無効にする（Pointer Events は止まらない）
    container.addEventListener('touchstart', this.onTouch, { passive: false })
    container.addEventListener('touchmove', this.onTouch, { passive: false })
    document.addEventListener('selectstart', this.onSelectStart)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
  }

  destroy() {
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    this.container.removeEventListener('pointerdown', this.onDown)
    this.container.removeEventListener('pointermove', this.onMove)
    this.container.removeEventListener('pointerup', this.onUp)
    this.container.removeEventListener('pointercancel', this.onCancel)
    this.container.removeEventListener('touchstart', this.onTouch)
    this.container.removeEventListener('touchmove', this.onTouch)
    document.removeEventListener('selectstart', this.onSelectStart)
    this.committed.remove()
    this.live.remove()
  }

  applyTouchAction() {
    this.container.style.touchAction = this.opts.touchMode() === 'native' ? 'pan-y' : 'none'
  }

  clear() {
    if (!this.strokes.length) return
    this.pushHistory()
    this.strokes = []
    this.redrawCommitted()
  }

  /** 1つ前の操作（描く・消す・全消去）を取り消す */
  undo() {
    const prev = this.history.pop()
    if (!prev) return
    this.strokes = prev
    this.redrawCommitted()
  }

  private pushHistory() {
    this.history.push(this.strokes)
    if (this.history.length > MAX_HISTORY) this.history.shift()
  }

  private resize() {
    this.dpr = window.devicePixelRatio || 1
    const { width, height } = this.container.getBoundingClientRect()
    for (const c of [this.committed, this.live]) {
      c.width = Math.round(width * this.dpr)
      c.height = Math.round(height * this.dpr)
    }
    this.redrawCommitted()
  }

  private ctx(c: HTMLCanvasElement) {
    const ctx = c.getContext('2d')!
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    return ctx
  }

  private redrawCommitted() {
    const ctx = this.ctx(this.committed)
    ctx.clearRect(0, 0, this.committed.width, this.committed.height)
    for (const s of this.strokes) drawStroke(ctx, s)
  }

  private pos(e: PointerEvent): Point {
    const r = this.container.getBoundingClientRect()
    const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5
    return [e.clientX - r.left, e.clientY - r.top, pressure]
  }

  private canDraw(e: PointerEvent) {
    if (e.pointerType === 'pen') return true
    if (e.pointerType === 'mouse') return e.button === 0
    // touch
    if (!this.opts.fingerDraw()) return false
    if (performance.now() - this.lastPenTime < PALM_MS || this.currentType === 'pen') {
      this.stats.palmRejected++
      return false
    }
    return true
  }

  private onDown = (e: PointerEvent) => {
    this.stats.pointerType = e.pointerType
    if (e.pointerType === 'pen') {
      this.lastPenTime = performance.now()
      // ペンが触れたら、指で描いている途中の線は取り消す（手のひら対策）
      if (this.current && this.currentType === 'touch') this.current = null
    }
    if (this.current || this.erasePointer >= 0) return
    if (this.canDraw(e) && this.tool === 'eraser') {
      this.container.setPointerCapture(e.pointerId)
      this.erasePointer = e.pointerId
      this.currentType = e.pointerType
      this.pushHistory()
      this.eraseChanged = false
      this.eraserPos = null
      const [x, y] = this.pos(e)
      this.eraseAt(x, y)
      this.schedule()
      e.preventDefault()
    } else if (this.canDraw(e)) {
      this.container.setPointerCapture(e.pointerId)
      const p = this.pos(e)
      this.current = { tool: this.tool as StrokeTool, color: this.color, points: [p], simulatePressure: e.pointerType !== 'pen', isLine: false }
      this.currentPointer = e.pointerId
      this.currentType = e.pointerType
      this.anchor = { x: p[0], y: p[1], t: performance.now() }
      this.schedule()
      e.preventDefault()
    } else if (e.pointerType === 'touch' && this.opts.touchMode() === 'manual' && this.panPointer < 0) {
      this.container.setPointerCapture(e.pointerId)
      this.panPointer = e.pointerId
      this.panLast = { x: e.clientX, y: e.clientY }
    }
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerType === 'pen') this.lastPenTime = performance.now()
    if (e.pointerId === this.panPointer) {
      this.opts.onPan?.(e.clientX - this.panLast.x, e.clientY - this.panLast.y)
      this.panLast = { x: e.clientX, y: e.clientY }
      return
    }
    if (e.pointerId === this.erasePointer) {
      const events = e.getCoalescedEvents?.() ?? [e]
      for (const ev of events.length ? events : [e]) {
        const [x, y] = this.pos(ev)
        this.eraseAt(x, y)
      }
      this.schedule()
      return
    }
    if (!this.current || e.pointerId !== this.currentPointer) return
    const events = e.getCoalescedEvents?.() ?? [e]
    const list = events.length ? events : [e]
    this.coalescedCounts.push(list.length)
    this.eventTimes.push(performance.now())
    this.pendingEventTime ||= e.timeStamp
    this.stats.pressure = e.pressure

    if (this.current.isLine) {
      // 直線化の後は終点だけをペン位置に追従させる
      this.current.points = [this.current.points[0], this.pos(e)]
    } else {
      for (const ev of list) this.current.points.push(this.pos(ev))
      const p = this.pos(e)
      if (Math.hypot(p[0] - this.anchor.x, p[1] - this.anchor.y) > HOLD_RADIUS) {
        this.anchor = { x: p[0], y: p[1], t: performance.now() }
      }
    }
    this.schedule()
  }

  private onUp = (e: PointerEvent) => {
    if (e.pointerId === this.panPointer) {
      this.panPointer = -1
      return
    }
    if (e.pointerId === this.erasePointer) {
      this.endErase()
      return
    }
    if (!this.current || e.pointerId !== this.currentPointer) return
    this.pushHistory()
    this.strokes = [...this.strokes, this.current]
    drawStroke(this.ctx(this.committed), this.current)
    this.current = null
    this.currentType = ''
    this.ctx(this.live).clearRect(0, 0, this.live.width, this.live.height)
  }

  private onTouch = (e: TouchEvent) => {
    const stylus = [...e.changedTouches].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus')
    // 指は「ブラウザ標準」方式のときだけOSに任せる（スクロールさせるため）
    if (stylus || this.opts.touchMode() === 'manual') e.preventDefault()
  }

  private onSelectStart = (e: Event) => {
    if (this.current || this.erasePointer >= 0) e.preventDefault()
  }

  private eraseAt(x: number, y: number) {
    // 速くなぞったときに線を飛び越さないよう、前回の位置との間を半径の半分おきに補間する
    const prev = this.eraserPos
    this.eraserPos = { x, y }
    if (prev) {
      const n = Math.floor(Math.hypot(x - prev.x, y - prev.y) / (ERASER_RADIUS / 2))
      for (let k = 1; k <= n; k++) this.eraseAtPoint(prev.x + ((x - prev.x) * k) / (n + 1), prev.y + ((y - prev.y) * k) / (n + 1))
    }
    this.eraseAtPoint(x, y)
  }

  private eraseAtPoint(x: number, y: number) {
    let changed = false
    const next: Stroke[] = []
    for (const s of this.strokes) {
      const pieces = eraseFromStroke(s, x, y, ERASER_RADIUS)
      if (pieces) {
        changed = true
        next.push(...pieces)
      } else {
        next.push(s)
      }
    }
    if (changed) {
      this.strokes = next
      this.eraseChanged = true
      this.committedDirty = true
    }
  }

  private endErase() {
    // 何も消さなかった場合は、元に戻すの履歴に残さない
    if (!this.eraseChanged) this.history.pop()
    this.erasePointer = -1
    this.currentType = ''
    this.eraserPos = null
    this.ctx(this.live).clearRect(0, 0, this.live.width, this.live.height)
  }

  private onCancel = (e: PointerEvent) => {
    this.stats.cancels++
    if (e.pointerId === this.erasePointer) this.endErase()
    if (e.pointerId === this.panPointer) this.panPointer = -1
    if (e.pointerId === this.currentPointer) {
      this.current = null
      this.currentType = ''
      this.ctx(this.live).clearRect(0, 0, this.live.width, this.live.height)
    }
    this.emitStats()
  }

  private schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame)
  }

  private frame = () => {
    this.raf = 0
    const now = performance.now()
    const ctx = this.ctx(this.live)
    ctx.clearRect(0, 0, this.live.width, this.live.height)
    if (this.committedDirty) {
      this.committedDirty = false
      this.redrawCommitted()
    }
    if (this.erasePointer >= 0 && this.eraserPos) {
      // 消しゴムの範囲を円で表示する
      ctx.beginPath()
      ctx.arc(this.eraserPos.x, this.eraserPos.y, ERASER_RADIUS, 0, Math.PI * 2)
      ctx.strokeStyle = '#888'
      ctx.lineWidth = 1
      ctx.stroke()
      return
    }
    if (!this.current) return

    if (!this.current.isLine && now - this.anchor.t >= this.opts.holdMs()) {
      const pts = this.current.points
      const first = pts[0]
      const last = pts[pts.length - 1]
      if (Math.hypot(last[0] - first[0], last[1] - first[1]) >= MIN_LINE_LENGTH) {
        const avg = pts.reduce((s, p) => s + p[2], 0) / pts.length
        this.current.points = [[first[0], first[1], avg], [last[0], last[1], avg]]
        this.current.isLine = true
        this.flashUntil = now + 150
        this.opts.onSnap?.()
      }
    }

    drawStroke(ctx, this.current, now < this.flashUntil)
    if (this.pendingEventTime) {
      this.latencies.push(now - this.pendingEventTime)
      this.pendingEventTime = 0
    }
    this.emitStats()
    // ペンが止まっていてもイベントが来ないため、描画中は毎フレーム直線化の判定を続ける
    this.schedule()
  }

  private lastEmit = 0
  private emitStats() {
    const now = performance.now()
    if (now - this.lastEmit < 250) return
    this.lastEmit = now
    this.eventTimes = this.eventTimes.filter((t) => now - t < 1000)
    this.coalescedCounts = this.coalescedCounts.slice(-120)
    this.latencies = this.latencies.slice(-120)
    const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)
    this.stats.eventsPerSec = this.eventTimes.length
    this.stats.coalescedAvg = avg(this.coalescedCounts)
    this.stats.latencyMs = avg(this.latencies)
    this.opts.onStats?.({ ...this.stats })
  }
}
