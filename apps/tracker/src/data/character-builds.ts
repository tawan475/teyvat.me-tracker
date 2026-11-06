/**
 * Every capture's builds (time travel on the character dialog). Every
 * snapshot holds the whole build: the roster, each weapon's wearer and each
 * artifact's wearer over the immutable catalog. So any capture's build can
 * be drawn again exactly; what happened between two captures (a swap tried
 * and undone within one world stay) was never stored. `loadBuildIndex`
 * reads the sections it needs for every snapshot, decoding each distinct
 * section once; the History rows come from character-gear.
 */

import {
  decodeCharacterExtras,
  decodeCharacters,
  decodeWeapons,
  type ArtifactsSection,
  type CatalogEntry,
  type GiCapture,
  type GiCharacter,
  type GoodArtifact,
  type GoodCharacter,
  type GoodWeapon,
  type KeyRef,
} from '@gdt/shared'
import { yieldToMain } from '@/lib/yield'
import { loadBundle, loadCatalog, loadSnapshots, type AccountRef } from './account-data'
import {
  gearDays,
  knownGear,
  wearers,
  type Capture,
  type Gear,
  type GearDay,
  type Worn,
} from './character-gear'
import { buildRoster, SLOT_ORDER, type CharacterView } from './characters'

interface Stored {
  id: number
  at: number
  capture: GiCapture | null
  characters: Map<string, GoodCharacter>
  weapons: Map<string, GoodWeapon>
  /** Null when the capture's artifact wearers were not read (`wearers`). */
  artifacts: Map<string, Worn> | null
  extras: Map<string, GiCharacter>
}

export interface BuildIndex {
  /** The character's captures, oldest first (only those that hold it). */
  captures(key: string): Capture[]
  /** Its gear changes as History rows, newest day first. */
  days(key: string): GearDay[]
  /**
   * The character as a capture had it, drawn like the live one; null when
   * absent or when the capture holds no gear for it (nothing to view).
   */
  character(snapshotId: number, key: string): CharacterView | null
  /** Whether `character` has a build to show for that capture. */
  viewable(snapshotId: number, key: string): boolean
  /** A catalog piece (the History rows' icons and main stats). */
  piece(id: number): CatalogEntry | undefined
  /** When a snapshot was taken and why. */
  capture(snapshotId: number): { at: number; capture: GiCapture | null } | null
}

const LOCK = 1
const ASTRAL_MARK = 2

/** GOOD names the Traveler by element (`TravelerCryo`) but their gear's location plainly `Traveler`. */
function wearerKey(key: string, has: (location: string) => boolean): string {
  return key.startsWith('Traveler') && !has(key) ? 'Traveler' : key
}

function indexOf(
  stored: readonly Stored[],
  catalog: ReadonlyMap<number, CatalogEntry>,
): BuildIndex {
  const byId = new Map(stored.map((s) => [s.id, s]))
  const captureCache = new Map<string, Capture[]>()
  const dayCache = new Map<string, GearDay[]>()

  function gearOf(s: Stored, key: string): Gear | null {
    const weapon = s.weapons.get(wearerKey(key, (l) => s.weapons.has(l))) ?? null
    const worn = wornBy(s, key)
    return knownGear(
      { weapon, pieces: worn ? worn.ids : SLOT_ORDER.map(() => null) },
      s.artifacts !== null,
    )
  }

  function wornBy(s: Stored, key: string): Worn | undefined {
    const artifacts = s.artifacts
    return artifacts?.get(wearerKey(key, (l) => artifacts.has(l)))
  }

  const index: BuildIndex = {
    captures(key) {
      let list = captureCache.get(key)
      if (!list) {
        list = stored
          .filter((s) => s.characters.has(key))
          .map((s) => ({ snapshotId: s.id, at: s.at, capture: s.capture, gear: gearOf(s, key) }))
        captureCache.set(key, list)
      }
      return list
    },
    days(key) {
      let list = dayCache.get(key)
      if (!list) dayCache.set(key, (list = gearDays(index.captures(key), catalog)))
      return list
    },
    character(snapshotId, key) {
      const s = byId.get(snapshotId)
      const character = s?.characters.get(key)
      if (!s || !character) return null
      const gear = gearOf(s, key)
      if (!gear) return null
      const worn = wornBy(s, key)
      const artifacts: GoodArtifact[] = []
      gear.pieces.forEach((id, i) => {
        const piece = id === null ? undefined : catalog.get(id)
        if (!piece) return
        const flags = worn?.flags[i] ?? 0
        artifacts.push({
          setKey: piece.setKey,
          slotKey: piece.slotKey,
          level: piece.level,
          rarity: piece.rarity,
          mainStatKey: piece.mainStatKey,
          location: key,
          lock: (flags & LOCK) !== 0,
          substats: piece.substats,
          totalRolls: piece.totalRolls,
          astralMark: (flags & ASTRAL_MARK) !== 0,
          elixirCrafted: piece.elixirCrafted,
          unactivatedSubstats: piece.unactivatedSubstats,
        })
      })
      const extra = s.extras.get(key)
      return (
        buildRoster({
          characters: [character],
          weapons: gear.weapon ? [{ ...gear.weapon, location: key }] : [],
          artifacts,
          gi_characters: extra ? { [key]: extra } : undefined,
        }).characters[0] ?? null
      )
    },
    viewable(snapshotId, key) {
      const s = byId.get(snapshotId)
      return !!s && s.characters.has(key) && gearOf(s, key) !== null
    },
    piece: (id) => catalog.get(id),
    capture(snapshotId) {
      const s = byId.get(snapshotId)
      return s ? { at: s.at, capture: s.capture } : null
    },
  }
  return index
}

/** Builds the index from a bundle's sections; each distinct section is decoded once. */
async function buildIndex(account: AccountRef): Promise<BuildIndex> {
  const [bundle, catalog, snapshots] = await Promise.all([
    loadBundle(account, { sections: ['characters', 'weapons', 'artifacts', 'characterExtras'] }),
    loadCatalog(account),
    loadSnapshots(account),
  ])
  const captures = new Map(snapshots.map((s) => [s.id, s.capture ?? null]))
  const json = <T>(hash: string | null | undefined): T | null => {
    const text = hash ? bundle.texts.get(hash) : undefined
    return text === undefined ? null : (JSON.parse(text) as T)
  }
  const once = <T>(cache: Map<string, T>, key: string, make: () => T): T => {
    let value = cache.get(key)
    if (value === undefined) cache.set(key, (value = make()))
    return value
  }
  const rosters = new Map<string, Map<string, GoodCharacter>>()
  const weaponMaps = new Map<string, Map<string, GoodWeapon>>()
  const artifactMaps = new Map<string, Map<string, Worn> | null>()
  const extraMaps = new Map<string, Map<string, GiCharacter>>()
  const empty = new Map()

  const stored: Stored[] = []
  const ordered = [...bundle.snapshots].sort((a, b) => a.takenAt - b.takenAt)
  for (let i = 0; i < ordered.length; i++) {
    const snapshot = ordered[i]!
    // Hundreds of snapshots: let the page breathe between batches.
    if (i % 25 === 24) await yieldToMain()
    const characters = once(rosters, snapshot.characters, () => {
      const rows = json<KeyRef[][]>(snapshot.characters)
      return new Map((rows ? decodeCharacters(rows) : []).map((c) => [c.key, c]))
    })
    const weapons = once(weaponMaps, snapshot.weapons, () => {
      const map = new Map<string, GoodWeapon>()
      for (const w of decodeWeapons(json<KeyRef[][]>(snapshot.weapons) ?? [])) {
        if (w.location && !map.has(w.location)) map.set(w.location, w)
      }
      return map
    })
    const artifacts = once(
      artifactMaps,
      `${snapshot.artifacts}:${snapshot.artifactsBase ?? ''}`,
      () => {
        const section = json<ArtifactsSection>(snapshot.artifacts)
        return section
          ? wearers(section, json<ArtifactsSection>(snapshot.artifactsBase), catalog)
          : new Map<string, Worn>()
      },
    )
    const extras = snapshot.characterExtras
      ? once(extraMaps, snapshot.characterExtras, () =>
          decodeCharacterExtras(json<KeyRef[][]>(snapshot.characterExtras) ?? []),
        )
      : empty
    stored.push({
      id: snapshot.id,
      at: snapshot.takenAt,
      capture: captures.get(snapshot.id) ?? null,
      characters,
      weapons,
      artifacts,
      extras,
    })
  }
  return indexOf(stored, catalog)
}

const built = new Map<string, Promise<BuildIndex>>()

/** Every capture's builds for the account; one per data version. */
export function loadBuildIndex(account: AccountRef): Promise<BuildIndex> {
  const key = `${account.source ?? 'own'}:${account.id}:${account.dataVersion}`
  let index = built.get(key)
  if (!index) {
    index = buildIndex(account)
    index.catch(() => built.delete(key))
    built.set(key, index)
    while (built.size > 4) built.delete(built.keys().next().value!)
  }
  return index
}
