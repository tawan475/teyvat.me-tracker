/** The benched list after a drag from `from` to `to` (indexes into `keys`). */
export function rangeBench(
  before: readonly string[],
  keys: readonly string[],
  from: number,
  to: number,
  bench: boolean,
): string[] {
  const range = new Set(keys.slice(Math.min(from, to), Math.max(from, to) + 1))
  const kept = before.filter((key) => bench || !range.has(key))
  if (!bench) return kept
  const held = new Set(kept)
  return [...kept, ...[...range].filter((key) => !held.has(key))]
}
