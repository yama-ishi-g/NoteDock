// 元に戻す／やり直し（内部仕様書 6.6）。
// 内容（線の配列・置いたものの配列）は書き換えずに新しい配列を作るため、操作の前後の状態を持つだけで履歴になる（中身は共有される）

export const MAX_HISTORY = 100

export class InkHistory<T> {
  private undoStack: T[] = []
  private redoStack: T[] = []

  /** 操作の直前の状態を記録する */
  record(before: T) {
    this.undoStack.push(before)
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift()
    this.redoStack = []
  }

  /** 直前に記録したものを取り消す（何も変わらなかった操作のため） */
  discardLast() {
    this.undoStack.pop()
  }

  undo(current: T): T | null {
    const prev = this.undoStack.pop()
    if (prev === undefined) return null
    this.redoStack.push(current)
    return prev
  }

  redo(current: T): T | null {
    const next = this.redoStack.pop()
    if (next === undefined) return null
    this.undoStack.push(current)
    return next
  }

  get canUndo() {
    return this.undoStack.length > 0
  }

  get canRedo() {
    return this.redoStack.length > 0
  }

  clear() {
    this.undoStack = []
    this.redoStack = []
  }
}
