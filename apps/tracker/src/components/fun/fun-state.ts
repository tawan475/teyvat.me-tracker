import { readDeviceWide, type DeviceWideFun, type FunStore } from '@/data/fun-storage'
import { readStorage, writeStorage } from '@/lib/storage'

const browserStore: FunStore = { read: readStorage, write: writeStorage }

/**
 * A Fun page's remembered value, read device-wide by data/fun-storage.ts's
 * rule over this browser's storage, parsed; `fallback` when nothing (or
 * nothing readable) is kept.
 */
export function readFunJson<T>(kind: DeviceWideFun, accountId: number | null, fallback: T): T {
  const raw = readDeviceWide(browserStore, kind, accountId)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
