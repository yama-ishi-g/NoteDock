import { create } from 'zustand'

// Promise で結果を返すダイアログ（確認・名前入力・選択・フォルダ選択）

export type ConfirmOptions = { title: string; message?: string; okLabel?: string; danger?: boolean }
export type PromptOptions = { title: string; label?: string; initial?: string; okLabel?: string; validate?: (value: string) => string | null; selectStem?: boolean }
export type ChooseOptions<T extends string> = { title: string; message?: string; options: { value: T; label: string; danger?: boolean }[] }
export type FolderPickOptions = { title: string; projectId: string; exclude?: string }

type Dialog =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: 'choose'; opts: ChooseOptions<string>; resolve: (v: string | null) => void }
  | { kind: 'folder'; opts: FolderPickOptions; resolve: (v: string | null) => void }

type DialogStore = {
  current: Dialog | null
  open: (d: Dialog) => void
  close: () => void
}

export const useDialogStore = create<DialogStore>((set) => ({
  current: null,
  open: (current) => set({ current }),
  close: () => set({ current: null }),
}))

const open = <T,>(make: (resolve: (v: T) => void) => Dialog) =>
  new Promise<T>((resolve) => {
    useDialogStore.getState().open(make((v) => {
      useDialogStore.getState().close()
      resolve(v)
    }))
  })

export const dialogs = {
  confirm: (opts: ConfirmOptions) => open<boolean>((resolve) => ({ kind: 'confirm', opts, resolve })),
  prompt: (opts: PromptOptions) => open<string | null>((resolve) => ({ kind: 'prompt', opts, resolve })),
  choose: <T extends string>(opts: ChooseOptions<T>) => open<T | null>((resolve) => ({ kind: 'choose', opts, resolve: resolve as (v: string | null) => void })),
  pickFolder: (opts: FolderPickOptions) => open<string | null>((resolve) => ({ kind: 'folder', opts, resolve })),
}
