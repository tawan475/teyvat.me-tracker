/**
 * "Now" while Teyvat.me Capture leaves a build section out (issue 12): its
 * `gi_off` names characters, weapons, artifacts or materials, the upload
 * carries none of them, and the newest snapshot that shared the section
 * stands in for it (the Planner's levels and bag too). Pure.
 */

import {
  OFF_SECTIONS,
  sharesSection,
  type Good,
  type LiveJournalResponse,
  type OffSection,
  type SnapshotResponse,
} from '@gdt/shared'

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

/**
 * When each stand-in of `from` was last seen (its `lastSeenAt`; 0 when no
 * snapshot shared the section): what the Planner's hand edits of a section
 * left out are measured against (hand-edits.ts `bagSighting`).
 */
export function sharedSightings(
  list: readonly Pick<SnapshotResponse, 'id' | 'lastSeenAt'>[],
  from: SharedSources,
): Partial<Record<OffSection, number>> {
  const seen: Partial<Record<OffSection, number>> = {}
  for (const [section, id] of Object.entries(from) as [OffSection, number | null][]) {
    seen[section] = id === null ? 0 : (list.find((s) => s.id === id)?.lastSeenAt ?? 0)
  }
  return seen
}

/** What a stand-in replaces in a decoded capture: the builds, and the roster's extras. */
export type SharedBuilds = Pick<
  Good,
  'characters' | 'weapons' | 'artifacts' | 'materials' | 'gi_characters'
>

/**
 * Puts every section `from` names into `good` from its stand-in (`donor`: a
 * snapshot decoded, null when it can't be read). A section no snapshot
 * shared stays as captured: empty.
 *
 * The characters' extras (`gi_characters`: friendship, EXP, when obtained)
 * follow the roster. Capture's Characters switch covers them, so with it off
 * both come from that one older capture, and extras the newest capture
 * carries all the same are not shown: never one capture's friendship and EXP
 * on another's characters. With the characters shared, the extras are
 * whatever that capture carries.
 */
export function takeSharedSections(
  good: SharedBuilds,
  from: SharedSources,
  donor: (id: number) => SharedBuilds | null,
): void {
  if ('characters' in from) delete good.gi_characters
  for (const section of OFF_SECTIONS) {
    const id = from[section]
    const shared = id === null || id === undefined ? null : donor(id)
    if (!shared) continue
    if (section === 'characters') {
      good.characters = shared.characters
      if (shared.gi_characters) good.gi_characters = shared.gi_characters
    } else if (section === 'weapons') good.weapons = shared.weapons
    else if (section === 'artifacts') good.artifacts = shared.artifacts
    else good.materials = shared.materials
  }
}

/**
 * The live journal as a page with a stood-in roster applies it: without
 * changes to the characters' extras (`gi_characters.*`). Capture drops them
 * with its Characters switch off; a build that still had a switch for the
 * extras alone sent them, and they would land on another capture's roster.
 */
export function rosterJournal(
  live: LiveJournalResponse,
  from: SharedSources | null | undefined,
): LiveJournalResponse {
  if (!from || !('characters' in from) || !live.changes) return live
  const changes = live.changes.filter(([, path]) => path[0] !== 'gi_characters')
  return changes.length === live.changes.length ? live : { ...live, changes }
}

/** Whether a snapshot with this `off` shared every section a figure reads. */
export function sharesAll(
  off: readonly string[] | undefined,
  sections: readonly OffSection[],
): boolean {
  return sections.every((section) => sharesSection(off, section))
}
