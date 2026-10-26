import type { Stroke } from './model'

// 元に戻す／やり直し（内部仕様書 6.6）。
// 線の配列は書き換えずに新しい配列を作るため、操作の前後の配列を持つだけで履歴になる（線のデータ自体は共有される）

export const MAX_HISTORY = 100

export class InkHistory {
  private undoStack: Stroke[][] = []
  private redoStack: Stroke[][] = []

  /** 操作の直前の状態を記録する */
  record(before: Stroke[]) {
    this.undoStack.push(before)
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift()
    this.redoStack = []
  }

  /** 直前に記録したものを取り消す（何も変わらなかった操作のため） */
  discardLast() {
    this.undoStack.pop()
  }

  undo(current: Stroke[]): Stroke[] | null {
    const prev = this.undoStack.pop()
    if (!prev) return null
    this.redoStack.push(current)
    return prev
  }

  redo(current: Stroke[]): Stroke[] | null {
    const next = this.redoStack.pop()
    if (!next) return null
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
