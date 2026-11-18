/**
 * "Now" while Teyvat.me Capture leaves a build section out (issue 12): its
 * `gi_off` names characters, weapons, artifacts or materials, the upload
 * carries none of them, and the newest snapshot that shared the section
 * stands in for it (the Planner's levels and bag too). Pure.
 */

import { OFF_SECTIONS, sharesSection, type OffSection, type SnapshotResponse } from '@gdt/shared'

/** Per section the snapshot left out: the snapshot it is read from instead (null: none shared it). */
export type SharedSources = Partial<Record<OffSection, number | null>>

/**
 * The build sections snapshot `id` left out, each with the newest snapshot
 * before it that shared it. Null when it left none out (or is not listed).
 * `list` is newest first, as the snapshot list comes.
 */
export function sharedSources(
  list: readonly Pick<SnapshotResponse, 'id' | 'off'>[],
  id: number,
): SharedSources | null {
  const index = list.findIndex((s) => s.id === id)
  const off = list[index]?.off
  if (index < 0 || !off) return null
  const from: SharedSources = {}
  let any = false
  for (const section of OFF_SECTIONS) {
    if (sharesSection(off, section)) continue
    any = true
    const donor = list.slice(index + 1).find((s) => sharesSection(s.off, section))
    from[section] = donor?.id ?? null
  }
  return any ? from : null
}

/** Whether a snapshot with this `off` shared every section a figure reads. */
export function sharesAll(
  off: readonly string[] | undefined,
  sections: readonly OffSection[],
): boolean {
  return sections.every((section) => sharesSection(off, section))
}
