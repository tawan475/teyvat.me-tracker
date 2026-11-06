import { hashArtifactIdentity, type ArtifactIdentity } from '../artifact'
import type { KeyDictionary } from '../dictionary'
import type { GiCollections, GiEndgame, GiExploration, GiTasks, Good } from '../good'
import { sha256Hex128 } from '../hash'
import { deflateRaw } from './compress'
import { normalizeGood, type NormalizedGood, type NormalizeOptions } from './normalize'
import {
  decodeAchievements,
  decodeAchievementTimes,
  decodeAnecdotes,
  decodeArtifacts,
  decodeCharacterExtras,
  decodeCharacters,
  decodeCollections,
  decodeExploration,
  decodeExtras,
  decodeProgress,
  decodeMaterials,
  decodePlayer,
  decodeTasks,
  decodeWardrobe,
  decodeWeapons,
  deltaPaysOff,
  encodeAchievements,
  encodeAchievementTimes,
  encodeAchievementTimesDelta,
  encodeAnecdotes,
  encodeArtifacts,
  encodeArtifactsDelta,
  encodeCharacterExtras,
  encodeCharacters,
  encodeCollections,
  encodeCollections2,
  encodeExploration,
  encodeExtras,
  encodeProgress,
  encodeMaterialsDelta,
  encodeMaterialsFull,
  encodeTasks,
  encodeWardrobe,
  encodeWeapons,
  makeSection,
  type AchievementTimesSection,
  type ArtifactsSection,
  type MaterialsSection,
  type Section,
  type SectionKind,
} from './sections'

/**
 * Small per-snapshot figures computed once at import, so the dashboard and
 * analysis views never have to open a snapshot's sections. Stored in the
 * row's `meta` (snapshot-meta.ts; v1 rows: JSON): a new field means a new
 * meta format byte there (older rows just lack the field).
 */
export interface SnapshotSummary {
  characters: number
  weapons: number
  artifacts: number
  materials: number
  mora: number
  primogem: number
  /**
   * Unlocked, unequipped 3★ / 4★ artifacts as of this snapshot (named this way
   * since migration 0008, which renamed the keys in stored rows).
   */
  artifact3: number
  artifact4: number
}

export interface PreparedSnapshot {
  good: NormalizedGood
  /** Catalog hash of each `good.artifacts` entry, in the same order. */
  artifactHashes: string[]
  summary: SnapshotSummary
}

/**
 * Step 1 of an import: validate and hash. Needs no database. The server
 * passes the material dictionary (`options.materials`), so a known material
 * key is never refused for its length.
 */
export async function prepareSnapshot(
  input: unknown,
  options: NormalizeOptions = {},
): Promise<PreparedSnapshot> {
  const good = normalizeGood(input, options)
  const artifactHashes = await Promise.all(
    good.artifacts.map((a) => hashArtifactIdentity(a.identity)),
  )
  return { good, artifactHashes, summary: summarize(good) }
}

function summarize(good: NormalizedGood): SnapshotSummary {
  let artifact3 = 0
  let artifact4 = 0
  for (const { identity, state } of good.artifacts) {
    if (state.lock || state.location !== '') continue
    if (identity.rarity === 3) artifact3++
    else if (identity.rarity === 4) artifact4++
  }
  return {
    characters: good.characters.length,
    weapons: good.weapons.length,
    artifacts: good.artifacts.length,
    materials: good.materials.size,
    mora: good.materials.get('Mora') ?? 0,
    primogem: good.materials.get('Primogem') ?? 0,
    artifact3,
    artifact4,
  }
}

/** irminsul's own top-level keys, one optional section each. */
export interface ExtraSections {
  player: Section | null
  achievementTimes: Section | null
  characterExtras: Section | null
  anecdotes: Section | null
  tasks: Section | null
  collections: Section | null
  collections2: Section | null
  wardrobe: Section | null
  exploration: Section | null
  progress: Section | null
  extras: Section | null
}

export interface EncodedSnapshot extends ExtraSections {
  characters: Section
  weapons: Section
  artifacts: Section
  materials: Section
  achievements: Section | null
  /**
   * For each section that can be stored as a delta (see `withBases`): the
   * full section it is a delta of, or null when it is stored in full.
   */
  materialsBase: string | null
  artifactsBase: string | null
  achievementTimesBase: string | null
  /**
   * Identity of the whole inventory. Built from the *full* form of every
   * section, so whether a section was stored in full or as a delta never
   * changes it. A file without irminsul's extra keys hashes exactly as it did
   * before they were stored.
   */
  contentHash: string
  /**
   * The content hash with the extra sections left out (equal to `contentHash`
   * when there are none): what a snapshot of this same capture has if it was
   * stored before the extras were kept, so re-uploading it stays a no-op.
   */
  legacyContentHash: string
  /**
   * The content hash with the anecdotes left out (equal to `contentHash`
   * when there are none): what this capture has if it was stored before
   * `gi_anecdotes` was kept, so re-uploading it stays a no-op.
   */
  preAnecdotesContentHash: string
  /**
   * The content hash with the tasks left out (equal to `contentHash` when
   * there are none): what this capture has if it was stored before
   * `gi_tasks` was kept, so re-uploading it stays a no-op.
   */
  preTasksContentHash: string
  /**
   * The content hash with the collections left out (equal to `contentHash`
   * when there are none): what this capture has if it was stored before
   * `gi_collections` was kept, so re-uploading it stays a no-op.
   */
  preCollectionsContentHash: string
  /**
   * The content hash with Capture 1.4.0's keys left out (gi_collections'
   * later parts and gi_wardrobe; equal to `contentHash` without them): what
   * the tracker stored such a file as before it kept them, so re-uploading
   * it stays a no-op.
   */
  preCollections2ContentHash: string
  /**
   * The content hash with the wardrobe left out (equal to `contentHash` when
   * there is none): what this capture has if it was stored before
   * `gi_wardrobe` was kept, so re-uploading it stays a no-op.
   */
  preWardrobeContentHash: string
  /**
   * The content hash with the exploration left out (equal to `contentHash`
   * when there is none): what this capture has if it was stored before
   * `gi_exploration` was kept, so re-uploading it stays a no-op.
   */
  preExplorationContentHash: string
  /**
   * The content hash a tracker from before Capture 1.7.0 gave this file
   * (gi_tasks' and gi_collections' 1.7.0 parts and the progress section left
   * out; equal to `contentHash` without them), so re-uploading it stays a no-op.
   */
  pre17ContentHash: string
  /**
   * The content hash a tracker from before Capture 1.8.0 gave this file
   * (the parts 1.8.0-1.11.0 added to the tasks, collections2 and exploration
   * left out, no extras section), so re-uploading it stays a no-op.
   */
  pre18ContentHash: string
  /**
   * The content hash a tracker from before Capture 1.17's quests gave this
   * file (gi_collections' quests left out), so re-uploading it stays a no-op.
   */
  pre19ContentHash: string
  /**
   * The content hash a tracker from before Capture 1.17.12's gi_endgame gave
   * this file (the extras section without its endgame part, absent when that
   * leaves nothing), so re-uploading it stays a no-op.
   */
  pre20ContentHash: string
  /**
   * The content hash a tracker from before Capture 1.17.20's co-op players
   * gave this file (the Stygian records' and fights' `players` left out of
   * the endgame), so re-uploading it stays a no-op.
   */
  pre21ContentHash: string
  /**
   * The content hash a tracker from before Capture 1.17.21's Spiral Abyss
   * record book gave this file (`gi_endgame.abyss` left out), so
   * re-uploading it stays a no-op.
   */
  pre22ContentHash: string
  /**
   * The content hash with the recipes left out of collections2 (equal to
   * `contentHash` without recipes): what a tracker from before Capture
   * 1.5.0's recipes stored such a file as, so re-uploading it stays a no-op.
   */
  preRecipesContentHash: string
}

/** The sections that do not depend on catalog ids, materials in full. */
export interface StaticSections extends ExtraSections {
  characters: Section
  weapons: Section
  materials: Section
  achievements: Section | null
}

/** The extra sections that are present, in a fixed order. */
export function extraSectionsOf(sections: ExtraSections): Section[] {
  return [
    sections.player,
    sections.achievementTimes,
    sections.characterExtras,
    sections.anecdotes,
    sections.tasks,
    sections.collections,
    sections.collections2,
    sections.wardrobe,
    sections.exploration,
    sections.progress,
    sections.extras,
  ].filter((s): s is Section => s !== null)
}

/**
 * Step 2a: everything that needs no catalog ids. A server can compute these
 * hashes before its first query and ask which sections already exist in the
 * same round trip as the catalog lookup.
 */
export async function encodeStaticSections(
  prepared: PreparedSnapshot,
  materialsDictionary: KeyDictionary,
): Promise<StaticSections> {
  const { good } = prepared
  const [
    characters,
    weapons,
    materials,
    achievements,
    player,
    achievementTimes,
    characterExtras,
    anecdotes,
    tasks,
    collections,
    collections2,
    wardrobe,
    exploration,
    progress,
    extras,
  ] = await Promise.all([
    makeSection('characters', encodeCharacters(good.characters)),
    makeSection('weapons', encodeWeapons(good.weapons)),
    makeSection('materials', encodeMaterialsFull(good.materials, materialsDictionary)),
    good.achievements ? makeSection('achievements', encodeAchievements(good.achievements)) : null,
    good.player ? makeSection('player', good.player) : null,
    good.achievementTimes
      ? makeSection('achievementTimes', encodeAchievementTimes(good.achievementTimes))
      : null,
    good.characterExtras
      ? makeSection('characterExtras', encodeCharacterExtras(good.characterExtras))
      : null,
    good.anecdotes ? makeSection('anecdotes', encodeAnecdotes(good.anecdotes)) : null,
    good.tasks ? makeSection('tasks', encodeTasks(good.tasks)) : null,
    optionalSection('collections', good.collections && encodeCollections(good.collections)),
    optionalSection('collections2', good.collections && encodeCollections2(good.collections)),
    good.wardrobe ? makeSection('wardrobe', encodeWardrobe(good.wardrobe)) : null,
    good.exploration ? makeSection('exploration', encodeExploration(good.exploration)) : null,
    optionalSection(
      'progress',
      encodeProgress({
        ...(good.achievementProgress ? { achievementProgress: good.achievementProgress } : {}),
        ...(good.events ? { events: good.events } : {}),
      }),
    ),
    optionalSection(
      'extras',
      encodeExtras({
        ...(good.teapot ? { teapot: good.teapot } : {}),
        ...(good.miliastra ? { miliastra: good.miliastra } : {}),
        ...(good.endgame ? { endgame: good.endgame } : {}),
      }),
    ),
  ])
  return {
    characters,
    weapons,
    materials,
    achievements,
    player,
    achievementTimes,
    characterExtras,
    anecdotes,
    tasks,
    collections,
    collections2,
    wardrobe,
    exploration,
    progress,
    extras,
  }
}

/** A section of `value`, or null for none. */
function optionalSection(kind: SectionKind, value: object | null): Promise<Section> | null {
  return value ? makeSection(kind, value) : null
}

/**
 * Step 2b, once the catalog has assigned ids: the artifacts section and the
 * content hash. Every section is still in full; the content hash is final
 * here, so an unchanged inventory is detected before any base is loaded.
 * Call {@link withBases} only when the snapshot will be stored.
 */
export async function completeSnapshot(
  sections: StaticSections,
  prepared: PreparedSnapshot,
  artifactIds: ReadonlyMap<string, number>,
): Promise<EncodedSnapshot> {
  const { good, artifactHashes } = prepared
  const refs = good.artifacts.map((artifact, index) => {
    const hash = artifactHashes[index]!
    const id = artifactIds.get(hash)
    if (id === undefined) throw new Error(`No catalog id for artifact ${hash}`)
    return { id, state: artifact.state }
  })
  const artifacts = await makeSection('artifacts', encodeArtifacts(refs))
  const base = [
    sections.characters.hash,
    sections.weapons.hash,
    artifacts.hash,
    sections.materials.hash,
    sections.achievements?.hash ?? '',
  ]
  const legacyContentHash = await sha256Hex128(base.join(':'))
  // Appended only when present, so a file without them keeps its old hash;
  // the anecdotes (kept later) after the first three, the same way.
  const extras = [sections.player, sections.achievementTimes, sections.characterExtras]
  const withExtras = [...base, ...extras.map((s) => s?.hash ?? '')]
  const preAnecdotesContentHash = extras.some((s) => s !== null)
    ? await sha256Hex128(withExtras.join(':'))
    : legacyContentHash
  const preTasksContentHash = sections.anecdotes
    ? await sha256Hex128([...withExtras, sections.anecdotes.hash].join(':'))
    : preAnecdotesContentHash
  /**
   * The rest of the chain, from the sections that later captures grew (the
   * tasks, collections2) and those added last: each key kept later is
   * appended only when present, with empty places for what a file lacks, so
   * a file without it keeps its old hash. Called again with the sections as
   * an older tracker stored them to name the hash it gave the same file.
   */
  const chain = async (
    tasks: Section | null,
    collections2: Section | null,
    exploration: Section | null,
    progress: Section | null,
    extras: Section | null,
  ) => {
    const hash = (parts: string[]) => sha256Hex128([...withExtras, ...parts].join(':'))
    const anecdotes = sections.anecdotes?.hash ?? ''
    // The tasks (kept later still) after the anecdotes.
    const preCollections = tasks ? await hash([anecdotes, tasks.hash]) : preTasksContentHash
    // The collections after the tasks.
    const preCollections2 = sections.collections
      ? await hash([anecdotes, tasks?.hash ?? '', sections.collections.hash])
      : preCollections
    const upToCollections = [anecdotes, tasks?.hash ?? '', sections.collections?.hash ?? '']
    // Capture 1.4.0's keys.
    const preWardrobe = collections2
      ? await hash([...upToCollections, collections2.hash])
      : preCollections2
    const preExploration = sections.wardrobe
      ? await hash([...upToCollections, collections2?.hash ?? '', sections.wardrobe.hash])
      : preWardrobe
    // Capture 1.6.0's exploration.
    const upToWardrobe = [
      ...upToCollections,
      collections2?.hash ?? '',
      sections.wardrobe?.hash ?? '',
    ]
    const preProgress = exploration
      ? await hash([...upToWardrobe, exploration.hash])
      : preExploration
    // Capture 1.7.0's achievement progress and events.
    const upToExploration = [...upToWardrobe, exploration?.hash ?? '']
    const preExtras = progress ? await hash([...upToExploration, progress.hash]) : preProgress
    // Capture 1.8.0's new top-level keys.
    const content = extras
      ? await hash([...upToExploration, progress?.hash ?? '', extras.hash])
      : preExtras
    return { preCollections, preCollections2, preWardrobe, preExploration, preProgress, content }
  }
  const full = await chain(
    sections.tasks,
    sections.collections2,
    sections.exploration,
    sections.progress,
    sections.extras,
  )
  const contentHash = full.content
  const { tasks, collections, exploration, endgame } = prepared.good
  // Capture 1.17.12's gi_endgame lives inside the extras section: what the
  // section was for trackers that did not know it (none, when it alone made one).
  const preEndgameExtras = endgame
    ? await optionalSection(
        'extras',
        encodeExtras({
          ...(prepared.good.teapot ? { teapot: prepared.good.teapot } : {}),
          ...(prepared.good.miliastra ? { miliastra: prepared.good.miliastra } : {}),
        }),
      )
    : sections.extras
  // The recipes (1.5.0) live inside collections2: what this file hashed to
  // where collections2 did not have them yet.
  const preRecipesContentHash = collections?.recipes
    ? (
        await chain(
          sections.tasks,
          await optionalSection(
            'collections2',
            encodeCollections2({ ...collections, recipes: undefined }),
          ),
          sections.exploration,
          sections.progress,
          sections.extras,
        )
      ).content
    : contentHash
  /**
   * The content hash a tracker from before `era` gave this file: the parts
   * that era and later ones added are left out of the sections they grew, and
   * the sections they added are absent.
   */
  const asOf = async (era: 17 | 18 | 19 | 20) => {
    const taskKeys = era === 17 ? [...TASKS_17, ...TASKS_18] : era === 18 ? TASKS_18 : []
    const collectionKeys =
      era === 17
        ? [...COLLECTIONS_17, ...COLLECTIONS_18, ...COLLECTIONS_19]
        : era === 18
          ? [...COLLECTIONS_18, ...COLLECTIONS_19]
          : era === 19
            ? COLLECTIONS_19
            : []
    const tcgKeys = era >= 19 ? [] : TCG_18
    const explorationKeys = era >= 19 ? [] : EXPLORATION_18
    const grewTasks = !!tasks && taskKeys.some((key) => tasks[key] !== undefined)
    const grewCollections =
      !!collections &&
      (collectionKeys.some((key) => collections[key] !== undefined) ||
        (!!collections.tcg && tcgKeys.some((key) => collections.tcg![key] !== undefined)))
    const grewExploration =
      !!exploration && explorationKeys.some((key) => exploration[key] !== undefined)
    // Every era before 1.17.12 stored the extras without the endgame.
    const added =
      era === 17
        ? sections.progress || sections.extras
        : era === 18
          ? sections.extras
          : endgame
            ? sections.extras
            : null
    if (!grewTasks && !grewCollections && !grewExploration && !added) return contentHash
    const olderCollections = (c: GiCollections) => {
      const out = withoutKeys(c, collectionKeys)
      return out.tcg ? { ...out, tcg: withoutKeys(out.tcg, tcgKeys) } : out
    }
    return (
      await chain(
        grewTasks
          ? await optionalSection('tasks', nonEmpty(encodeTasks(withoutKeys(tasks!, taskKeys))))
          : sections.tasks,
        grewCollections
          ? await optionalSection(
              'collections2',
              encodeCollections2(olderCollections(collections!)),
            )
          : sections.collections2,
        grewExploration
          ? await optionalSection(
              'exploration',
              nonEmpty(encodeExploration(withoutKeys(exploration!, explorationKeys))),
            )
          : sections.exploration,
        era === 17 ? null : sections.progress,
        era >= 19 ? preEndgameExtras : null,
      )
    ).content
  }
  const pre17ContentHash = await asOf(17)
  const pre18ContentHash = await asOf(18)
  const pre19ContentHash = await asOf(19)
  const pre20ContentHash = await asOf(20)
  // Capture 1.17.20's co-op players and 1.17.21's Abyss record book live
  // inside the endgame: what the extras section was for trackers that
  // dropped them (before 1.17.20, both; before 1.17.21, the book).
  const coop = endgame?.stygian?.records.some(
    (r) => r.players !== undefined || r.fights.some((f) => f.players !== undefined),
  )
  const book = endgame?.abyss !== undefined
  const hashWithEndgame = async (older: GiEndgame) =>
    (
      await chain(
        sections.tasks,
        sections.collections2,
        sections.exploration,
        sections.progress,
        await optionalSection(
          'extras',
          encodeExtras({
            ...(prepared.good.teapot ? { teapot: prepared.good.teapot } : {}),
            ...(prepared.good.miliastra ? { miliastra: prepared.good.miliastra } : {}),
            endgame: older,
          }),
        ),
      )
    ).content
  const pre21ContentHash =
    coop || book ? await hashWithEndgame(withoutCoop(withoutBook(endgame!))) : contentHash
  const pre22ContentHash = book ? await hashWithEndgame(withoutBook(endgame!)) : contentHash
  return {
    ...sections,
    artifacts,
    materialsBase: null,
    artifactsBase: null,
    achievementTimesBase: null,
    contentHash,
    legacyContentHash,
    preAnecdotesContentHash,
    preTasksContentHash,
    preCollectionsContentHash: full.preCollections,
    preCollections2ContentHash: full.preCollections2,
    preWardrobeContentHash: full.preWardrobe,
    preExplorationContentHash: full.preExploration,
    preRecipesContentHash,
    pre17ContentHash,
    pre18ContentHash,
    pre19ContentHash,
    pre20ContentHash,
    pre21ContentHash,
    pre22ContentHash,
  }
}

/** The endgame as trackers before Capture 1.17.21's Abyss record book stored it. */
function withoutBook(endgame: GiEndgame): GiEndgame {
  if (!endgame.abyss) return endgame
  const { abyss: _abyss, ...rest } = endgame
  return rest
}

/** The endgame as trackers before Capture 1.17.20's co-op players stored it. */
function withoutCoop(endgame: GiEndgame): GiEndgame {
  if (!endgame.stygian) return endgame
  return {
    ...endgame,
    stygian: {
      records: endgame.stygian.records.map(({ players: _players, ...r }) => ({
        ...r,
        fights: r.fights.map(({ players: _teams, ...f }) => f),
      })),
    },
  }
}

/** gi_tasks' and gi_collections' parts from Capture 1.7.0 (see pre17ContentHash). */
const TASKS_17 = [
  'weeklyBosses',
  'respawns',
  'arRewards',
] as const satisfies readonly (keyof GiTasks)[]
const COLLECTIONS_17 = [
  'hangouts',
  'monstersSeen',
  'blueprints',
] as const satisfies readonly (keyof GiCollections)[]
/** Capture 1.8.0-1.11.0's parts of the sections they grew (see pre18ContentHash). */
const TASKS_18 = ['signIns'] as const satisfies readonly (keyof GiTasks)[]
const COLLECTIONS_18 = [
  'crafting',
  'musicGame',
  'furnishingSets',
  'companionRewards',
  'npcsMet',
] as const satisfies readonly (keyof GiCollections)[]
const TCG_18 = ['levels', 'bosses', 'tavern'] as const
/** Capture 1.17's part of gi_collections (see pre19ContentHash). */
const COLLECTIONS_19 = ['quests'] as const satisfies readonly (keyof GiCollections)[]
const EXPLORATION_18 = [
  'domainsCleared',
  'tribalChapters',
] as const satisfies readonly (keyof GiExploration)[]

function withoutKeys<T extends object>(value: T, keys: readonly PropertyKey[]): T {
  const out = { ...value }
  for (const key of keys) delete (out as Record<PropertyKey, unknown>)[key]
  return out
}

const nonEmpty = <T extends object>(value: T): T | null =>
  Object.keys(value).length > 0 ? value : null

/** Steps 2a and 2b together. */
export async function encodeSnapshot(
  prepared: PreparedSnapshot,
  artifactIds: ReadonlyMap<string, number>,
  materialsDictionary: KeyDictionary,
): Promise<EncodedSnapshot> {
  return completeSnapshot(
    await encodeStaticSections(prepared, materialsDictionary),
    prepared,
    artifactIds,
  )
}

/** A full section stored earlier, which a new snapshot's section may be a delta of. */
export interface SectionBase {
  hash: string
  /** The section's JSON (inflated). */
  json: string
  /** What it takes in storage: its deflated size in bytes. */
  size: number
}

/** The bases a new snapshot may use: those of the account's latest snapshot. */
export interface SnapshotBases {
  materials: SectionBase | null
  artifacts: SectionBase | null
  achievementTimes: SectionBase | null
}

/**
 * Step 3, only for a snapshot that will be stored: re-expresses materials,
 * artifacts and achievement times as deltas against `bases` where that is
 * cheaper (see "bases & deltas" in sections.ts). A section stays in full when
 * there is no base, when its full form is already stored (`isStored`; then it
 * costs nothing, as when nothing changed since the base), or when its delta
 * has grown past the point where a new base pays off. A delta that is already
 * stored (the latest snapshot's, when the section did not change since) is
 * always used. The content hash is unaffected.
 */
export async function withBases(
  encoded: EncodedSnapshot,
  prepared: PreparedSnapshot,
  materialsDictionary: KeyDictionary,
  bases: SnapshotBases,
  isStored: (hash: string) => boolean = () => false,
): Promise<EncodedSnapshot> {
  const times = encoded.achievementTimes
  const [materials, artifacts, achievementTimes] = await Promise.all([
    rebase(encoded.materials, bases.materials, isStored, (base) => {
      const keyframe = JSON.parse(base.json) as MaterialsSection
      if (keyframe.b !== undefined) return null
      return encodeMaterialsDelta(prepared.good.materials, materialsDictionary, {
        hash: base.hash,
        materials: decodeMaterials(keyframe, materialsDictionary, null),
      })
    }),
    rebase(encoded.artifacts, bases.artifacts, isStored, (base) => {
      const full = JSON.parse(base.json) as ArtifactsSection
      if (full.b !== undefined) return null
      return encodeArtifactsDelta(JSON.parse(encoded.artifacts.json), full, base.hash)
    }),
    times
      ? rebase(times, bases.achievementTimes, isStored, (base) => {
          const full = JSON.parse(base.json) as AchievementTimesSection
          if (full.b !== undefined) return null
          return encodeAchievementTimesDelta(JSON.parse(times.json), full, base.hash)
        })
      : { section: null, base: null },
  ])
  return {
    ...encoded,
    materials: materials.section,
    materialsBase: materials.base,
    artifacts: artifacts.section,
    artifactsBase: artifacts.base,
    achievementTimes: achievementTimes.section,
    achievementTimesBase: achievementTimes.base,
  }
}

/** `full`, or its delta against `base` when that is cheaper. */
async function rebase(
  full: Section,
  base: SectionBase | null,
  isStored: (hash: string) => boolean,
  delta: (base: SectionBase) => object | null,
): Promise<{ section: Section; base: string | null }> {
  const asFull = { section: full, base: null }
  if (!base || full.hash === base.hash || isStored(full.hash)) return asFull
  // A base that is itself a delta cannot be built on (never happens: bases are
  // read from a snapshot's base columns, which only ever name full sections).
  const value = delta(base)
  if (!value) return asFull
  const section = await makeSection(full.kind, value)
  if (isStored(section.hash)) return { section, base: base.hash }
  const size = (await deflateRaw(section.json)).length
  return deltaPaysOff(size, base.size) ? { section, base: base.hash } : asFull
}

/** A snapshot as read back from storage, sections already inflated to JSON text. */
export interface StoredSnapshot {
  format: string
  version: number
  source: string
  takenAt: number
  characters: string
  weapons: string
  artifacts: string
  /** Required when `artifacts` is a delta; absent or null when it is full. */
  artifactsBase?: string | null
  materials: string
  /** Required when `materials` is a delta. */
  materialsKeyframe: string | null
  achievements: string | null
  // irminsul's extra sections; absent or null when the snapshot has none.
  player?: string | null
  achievementTimes?: string | null
  /** Required when `achievementTimes` is a delta; absent or null when it is full. */
  achievementTimesBase?: string | null
  characterExtras?: string | null
  anecdotes?: string | null
  tasks?: string | null
  collections?: string | null
  collections2?: string | null
  wardrobe?: string | null
  exploration?: string | null
  progress?: string | null
  extras?: string | null
}

const parseOrNull = <T>(text: string | null | undefined): T | null =>
  text ? (JSON.parse(text) as T) : null

/** Rebuilds the GOOD file a stored snapshot came from. Runs in the browser. */
export function decodeSnapshot(
  stored: StoredSnapshot,
  catalog: ReadonlyMap<number, ArtifactIdentity>,
  materialsDictionary: KeyDictionary,
): Good {
  const materials = decodeMaterials(
    JSON.parse(stored.materials),
    materialsDictionary,
    stored.materialsKeyframe === null ? null : JSON.parse(stored.materialsKeyframe),
  )
  const good: Good = {
    format: stored.format,
    version: stored.version,
    source: stored.source,
    characters: decodeCharacters(JSON.parse(stored.characters)),
    artifacts: decodeArtifacts(
      JSON.parse(stored.artifacts),
      catalog,
      parseOrNull(stored.artifactsBase),
    ),
    weapons: decodeWeapons(JSON.parse(stored.weapons)),
    materials: Object.fromEntries(materials),
  }
  if (stored.achievements !== null) {
    good.gi_achievements = decodeAchievements(JSON.parse(stored.achievements))
  }
  good.timestamp = stored.takenAt
  // After `timestamp`, where irminsul writes them.
  if (stored.player) good.gi_player = decodePlayer(JSON.parse(stored.player))
  if (stored.achievementTimes) {
    good.gi_achievement_times = Object.fromEntries(
      decodeAchievementTimes(
        JSON.parse(stored.achievementTimes),
        parseOrNull(stored.achievementTimesBase),
      ).map(([id, at]) => [String(id), at]),
    )
  }
  if (stored.characterExtras) {
    good.gi_characters = Object.fromEntries(
      decodeCharacterExtras(JSON.parse(stored.characterExtras)),
    )
  }
  if (stored.anecdotes) good.gi_anecdotes = decodeAnecdotes(JSON.parse(stored.anecdotes))
  if (stored.tasks) good.gi_tasks = decodeTasks(JSON.parse(stored.tasks))
  if (stored.collections || stored.collections2) {
    good.gi_collections = {
      ...(stored.collections ? decodeCollections(JSON.parse(stored.collections)) : {}),
      ...(stored.collections2 ? decodeCollections(JSON.parse(stored.collections2)) : {}),
    }
  }
  if (stored.wardrobe) good.gi_wardrobe = decodeWardrobe(JSON.parse(stored.wardrobe))
  if (stored.exploration) {
    good.gi_exploration = decodeExploration(JSON.parse(stored.exploration))
  }
  if (stored.progress) {
    const parts = decodeProgress(JSON.parse(stored.progress))
    if (parts.achievementProgress) good.gi_achievement_progress = parts.achievementProgress
    if (parts.events) good.gi_events = parts.events
  }
  if (stored.extras) {
    const parts = decodeExtras(JSON.parse(stored.extras))
    if (parts.teapot) good.gi_teapot = parts.teapot
    if (parts.miliastra) good.gi_miliastra = parts.miliastra
    if (parts.endgame) good.gi_endgame = parts.endgame
  }
  return good
}
