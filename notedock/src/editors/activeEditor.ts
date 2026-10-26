/** 開いているエディタの未保存の内容を保存する（名前の変更・移動・削除の前に呼ぶ） */
export const activeEditor: { flush: () => Promise<void> } = { flush: async () => {} }
