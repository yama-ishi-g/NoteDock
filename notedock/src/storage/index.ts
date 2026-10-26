import { OpfsStorage } from './OpfsStorage'
import type { StorageService } from './StorageService'

let storage: StorageService | null = null

/** アプリ全体で使う StorageService（テストでは setStorage で差し替える） */
export function getStorage(): StorageService {
  storage ??= new OpfsStorage()
  return storage
}

export function setStorage(s: StorageService) {
  storage = s
}

export async function requestPersist(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}
