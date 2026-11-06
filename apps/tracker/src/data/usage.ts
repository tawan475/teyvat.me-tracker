import type { UsageResponse } from '@gdt/shared'
import { shallowRef } from 'vue'
import { api } from '@/api'

/**
 * What the signed-in user stores against their quota (`GET /api/me/usage`):
 * one promise shared by every reader until something changes it. Pages key
 * their `useResource` on `usageVersion` beside the account's data version,
 * so a compaction, a delete or a wish import here re-reads it; the live
 * events that bump the account's version do the rest.
 */
let cached: Promise<UsageResponse> | null = null
export const usageVersion = shallowRef(0)

export function loadUsage(): Promise<UsageResponse> {
  if (!cached) {
    cached = api.usage()
    cached.catch(() => (cached = null))
  }
  return cached
}

/** Forgets the held answer; readers keyed on `usageVersion` read again. */
export function invalidateUsage(): void {
  cached = null
  usageVersion.value++
}
