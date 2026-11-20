/**
 * Keeps the answer of a read for a while in this Worker instance, so many
 * staff opening the same page cost one read (services/insights.ts). A failed
 * read is not kept.
 */

const kept = new Map<string, { until: number; value: Promise<unknown> }>()

export function keep<T>(key: string, ttl: number, now: number, read: () => Promise<T>): Promise<T> {
  const hit = kept.get(key)
  if (hit && hit.until > now) return hit.value as Promise<T>
  const value = read()
  kept.set(key, { until: now + ttl, value })
  value.catch(() => kept.delete(key))
  if (kept.size > 200) {
    for (const [k, entry] of kept) if (entry.until <= now) kept.delete(k)
  }
  return value
}

/** Forgets every kept read (tests). */
export function forgetKept(): void {
  kept.clear()
}
