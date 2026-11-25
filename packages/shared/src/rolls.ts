/**
 * Exact substat rolls (`gi_rolls`, contract v1: Teyvat.me Capture writes
 * every roll the game lists for an artifact). Free of zod: the app's startup
 * code imports it through `@gdt/shared/rolls`.
 *
 * Rolls are never part of an artifact's identity or of any hash: they ride
 * beside the identity (`ArtifactOccurrence.rolls`, the catalog chunk's rolls
 * block, the catalog row's eleventh element).
 */

type Tiers = readonly number[]

/**
 * Roll values per rarity and substat, lowest tier first: the game's
 * ReliquaryAffixExcelConfigData values (percentages are exact; flat stats
 * rounded to 0.01). Tier n (1-based) is `ROLL_TIERS[rarity][key][n - 1]`.
 */
export const ROLL_TIERS: Readonly<Record<number, Readonly<Record<string, Tiers>>>> = {
  5: {
    hp: [209.13, 239, 268.88, 298.75],
    atk: [13.62, 15.56, 17.51, 19.45],
    def: [16.2, 18.52, 20.83, 23.15],
    hp_: [4.08, 4.66, 5.25, 5.83],
    atk_: [4.08, 4.66, 5.25, 5.83],
    def_: [5.1, 5.83, 6.56, 7.29],
    eleMas: [16.32, 18.65, 20.98, 23.31],
    enerRech_: [4.53, 5.18, 5.83, 6.48],
    critRate_: [2.72, 3.11, 3.5, 3.89],
    critDMG_: [5.44, 6.22, 6.99, 7.77],
  },
  4: {
    hp: [167.3, 191.2, 215.1, 239],
    atk: [10.89, 12.45, 14, 15.56],
    def: [12.96, 14.82, 16.67, 18.52],
    hp_: [3.26, 3.73, 4.2, 4.66],
    atk_: [3.26, 3.73, 4.2, 4.66],
    def_: [4.08, 4.66, 5.25, 5.83],
    eleMas: [13.06, 14.92, 16.79, 18.65],
    enerRech_: [3.63, 4.14, 4.66, 5.18],
    critRate_: [2.18, 2.49, 2.8, 3.11],
    critDMG_: [4.35, 4.97, 5.6, 6.22],
  },
  3: {
    hp: [100.38, 114.72, 129.06, 143.4],
    atk: [6.54, 7.47, 8.4, 9.34],
    def: [7.78, 8.89, 10, 11.11],
    hp_: [2.45, 2.8, 3.15, 3.5],
    atk_: [2.45, 2.8, 3.15, 3.5],
    def_: [3.06, 3.5, 3.93, 4.37],
    eleMas: [9.79, 11.19, 12.59, 13.99],
    enerRech_: [2.72, 3.11, 3.5, 3.89],
    critRate_: [1.63, 1.86, 2.1, 2.33],
    critDMG_: [3.26, 3.73, 4.2, 4.66],
  },
  2: {
    hp: [50.19, 60.95, 71.7],
    atk: [3.27, 3.97, 4.67],
    def: [3.89, 4.72, 5.56],
    hp_: [1.63, 1.98, 2.33],
    atk_: [1.63, 1.98, 2.33],
    def_: [2.04, 2.48, 2.91],
    eleMas: [6.53, 7.93, 9.33],
    enerRech_: [1.81, 2.2, 2.59],
    critRate_: [1.09, 1.32, 1.55],
    critDMG_: [2.18, 2.64, 3.11],
  },
  1: {
    hp: [23.9, 29.88],
    atk: [1.56, 1.95],
    def: [1.85, 2.31],
    hp_: [1.17, 1.46],
    atk_: [1.17, 1.46],
    def_: [1.46, 1.82],
    eleMas: [4.66, 5.83],
    enerRech_: [1.3, 1.62],
    critRate_: [0.78, 0.97],
    critDMG_: [1.55, 1.94],
  },
}

/** Roll values for a substat at a rarity, lowest first; [] for an unknown key or rarity. */
export function rollTiers(key: string, rarity: number): Tiers {
  const byKey = Object.hasOwn(ROLL_TIERS, rarity) ? ROLL_TIERS[rarity]! : undefined
  return (byKey && Object.hasOwn(byKey, key) ? byKey[key] : undefined) ?? []
}

/** The value of `tier` (1-based) of a substat at a rarity, from ROLL_TIERS; undefined when it has none. */
export function rollValue(key: string, rarity: number, tier: number): number | undefined {
  const tiers = rollTiers(key, rarity)
  return Number.isInteger(tier) && tier >= 1 ? tiers[tier - 1] : undefined
}

/**
 * An artifact's rolls in memory and on the wire, one string:
 * - Capture's `gi_rolls` as is: two digits per roll, line (the index into
 *   `substats`) then tier (1-based), in the game's order across lines;
 * - or `~` and the same pairs grouped by line, lines ascending, each line's
 *   rolls in their own order, when only the order within a line is known
 *   (GGScanner's per-substat `rolls`: `readRollLists`).
 * Only ever holds a text `checkRolls` accepted.
 */
export type RollsText = string

/** Marks a RollsText whose order across lines is unknown. */
export const UNORDERED_ROLLS = '~'

/** Rolls an artifact can list at most (a 5★ has nine); longer texts are refused unread. */
export const MAX_ROLLS = 16

/**
 * Substat lines an artifact with rolls can have (the game gives four):
 * `checkRolls` refuses more, so every text it accepts has lines 0-3 and
 * tiers 1-4, which the catalog's packed rolls record holds exactly.
 */
export const MAX_ROLL_LINES = 4

/** Longest RollsText there can be: the `~` and MAX_ROLLS pairs. */
export const MAX_ROLLS_TEXT = 1 + 2 * MAX_ROLLS

const ROLLS_FORMAT = /^~?(?:\d\d){1,16}$/

/** Whether `value` has a RollsText's shape (not whether it fits an artifact: see checkRolls). */
export function isRollsText(value: unknown): value is RollsText {
  return typeof value === 'string' && value.length <= MAX_ROLLS_TEXT && ROLLS_FORMAT.test(value)
}

/** Whether a RollsText knows the order across lines (Capture's form, no `~`). */
export function rollsOrdered(text: RollsText): boolean {
  return !text.startsWith(UNORDERED_ROLLS)
}

/**
 * Whether the catalog can store `value` (its one rolls record layout): a
 * RollsText of 1 to MAX_ROLLS rolls, every line 0 to MAX_ROLL_LINES - 1 and
 * every tier 1 to 4, and for a `~` text its lines grouped and ascending.
 * Every text `checkRolls` accepts has this shape; nothing else can be stored.
 */
export function isStorableRolls(value: unknown): value is RollsText {
  if (!isRollsText(value)) return false
  const ordered = rollsOrdered(value)
  let previous = 0
  for (const [line, tier] of rollPairs(value)) {
    if (line >= MAX_ROLL_LINES || tier < 1 || tier > 4) return false
    if (!ordered && line < previous) return false
    previous = line
  }
  return true
}

/** Every roll as [line, tier], in the text's order. */
export function rollPairs(text: RollsText): [number, number][] {
  const start = rollsOrdered(text) ? 0 : 1
  const pairs: [number, number][] = []
  for (let i = start; i + 1 < text.length; i += 2) {
    pairs.push([text.charCodeAt(i) - 48, text.charCodeAt(i + 1) - 48])
  }
  return pairs
}

/** Per line (index into `substats`), its tiers in order; `lines` entries, [] for a line with none. */
export function rollsByLine(text: RollsText, lines: number): number[][] {
  const byLine: number[][] = Array.from({ length: Math.max(0, lines) }, () => [])
  for (const [line, tier] of rollPairs(text)) byLine[line]?.push(tier)
  return byLine
}

/** What `checkRolls` reads of an artifact. */
export interface RollsSubject {
  rarity: number
  totalRolls?: number
  substats: readonly { key: string; value: number; initialValue?: number }[]
}

/** The game's display rounding, as the contract says: 0.1 for percentages, whole flat stats. */
function tolerance(key: string): number {
  return key.endsWith('_') ? 0.051 : 0.54
}

/**
 * The contract's reader checks (gi_rolls v1): `text` when it holds every
 * roll of `artifact` and agrees with its substats, else undefined. Pure and
 * cheap; never throws, whatever it is given.
 *
 * 1. digits, two per roll, `totalRolls` > 0 of them (at most MAX_ROLLS);
 *    at most MAX_ROLL_LINES substat lines;
 * 2. every line below `substats.length`;
 * 3. every tier from 1 to the number of tiers the stat has at this rarity;
 * 4. lines in first-appearance order (for `~` text: lines ascending);
 * 5. every line rolled at least once;
 * 6. a line's first roll matches its `initialValue`, when it has one;
 * 7. a line's rolls add up to its `value`.
 */
export function checkRolls(artifact: unknown, text: unknown): RollsText | undefined {
  if (!isRollsText(text)) return undefined
  if (typeof artifact !== 'object' || artifact === null) return undefined
  const { rarity, totalRolls, substats } = artifact as Partial<RollsSubject>
  if (typeof rarity !== 'number' || typeof totalRolls !== 'number') return undefined
  if (!Array.isArray(substats) || substats.length === 0) return undefined
  if (substats.length > MAX_ROLL_LINES) return undefined
  const ordered = rollsOrdered(text)
  // 1. Whole pairs, as many as the artifact's rolls.
  if (!Number.isInteger(totalRolls) || totalRolls <= 0) return undefined
  if (text.length !== (ordered ? 0 : 1) + 2 * totalRolls) return undefined

  const lines = substats.length
  const sums = new Array<number>(lines).fill(0)
  const firsts = new Array<number | undefined>(lines).fill(undefined)
  let seen = 0
  let previous = 0
  for (const [line, tier] of rollPairs(text)) {
    // 2. The line exists.
    if (line >= lines) return undefined
    // 4. First-appearance order: a new line is the next one up. For `~` text
    //    the lines are grouped and ascending, which implies the same.
    if (line >= seen) {
      if (line !== seen) return undefined
      seen++
    }
    if (!ordered && line < previous) return undefined
    previous = line
    const substat = substats[line] as unknown
    if (typeof substat !== 'object' || substat === null) return undefined
    const { key } = substat as { key?: unknown }
    if (typeof key !== 'string') return undefined
    // 3. A tier this stat has at this rarity.
    const value = rollValue(key, rarity, tier)
    if (value === undefined) return undefined
    sums[line]! += value
    if (firsts[line] === undefined) firsts[line] = value
  }
  // 5. Every line rolled.
  if (seen !== lines) return undefined
  for (let line = 0; line < lines; line++) {
    const { key, value, initialValue } = substats[line]!
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
    const limit = tolerance(key)
    // 6. The first roll is the starting value.
    if (
      initialValue !== undefined &&
      (typeof initialValue !== 'number' || !(Math.abs(firsts[line]! - initialValue) <= limit))
    ) {
      return undefined
    }
    // 7. The rolls add up to the value.
    if (!(Math.abs(sums[line]! - value) <= limit)) return undefined
  }
  return text
}

/**
 * How far a listed roll may sit from its tier (display units): GGScanner's
 * packet captures list the game's own values, which the tier table holds
 * rounded to 0.01.
 */
function listTolerance(key: string): number {
  return key.endsWith('_') ? 0.011 : 0.051
}

/**
 * GGScanner's per-substat roll lists (`substats[n].rolls`: that line's roll
 * values in display units, 3.89 not 0.0389, in the order they happened
 * within the line) as a `~` RollsText, or undefined. Every substat must
 * carry a list of 1 to MAX_ROLLS finite numbers (MAX_ROLLS in all) and every
 * value must sit within 0.011 (percentages) / 0.051 (flat stats) of a tier of
 * that stat at `rarity`; anything else gives undefined. Not checked against
 * the piece's values: pass the result to `checkRolls`. Never throws.
 */
export function readRollLists(rarity: unknown, substats: unknown): RollsText | undefined {
  if (typeof rarity !== 'number' || !Array.isArray(substats)) return undefined
  if (substats.length === 0 || substats.length > MAX_ROLL_LINES) return undefined
  let text = UNORDERED_ROLLS
  let count = 0
  for (let line = 0; line < substats.length; line++) {
    const substat = substats[line] as unknown
    if (typeof substat !== 'object' || substat === null) return undefined
    const { key, rolls } = substat as { key?: unknown; rolls?: unknown }
    if (typeof key !== 'string' || !Array.isArray(rolls)) return undefined
    if (rolls.length === 0 || rolls.length > MAX_ROLLS - count) return undefined
    const tiers = rollTiers(key, rarity)
    const limit = listTolerance(key)
    for (const value of rolls as unknown[]) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
      let tier = 0
      let best = Infinity
      tiers.forEach((tierValue, index) => {
        const off = Math.abs(tierValue - value)
        if (off < best) {
          best = off
          tier = index + 1
        }
      })
      if (!(best <= limit)) return undefined
      text += `${line}${tier}`
      count++
    }
  }
  return text
}

/**
 * The substats of a piece whose rolls are a `~` text, each with its `rolls`
 * list as GGScanner writes it (the tier values from ROLL_TIERS, display
 * units, in the text's order): the way such rolls are given back, so that
 * `readRollLists` reads the same text again. New objects: the ones given
 * are left as they are. Pass only a text `checkRolls` accepted for them.
 */
export function withRollLists<S extends { key: string }>(
  substats: readonly S[],
  rarity: number,
  text: RollsText,
): (S & { rolls: number[] })[] {
  const byLine = rollsByLine(text, substats.length)
  return substats.map((substat, line) => ({
    ...substat,
    rolls: byLine[line]!.map((tier) => rollValue(substat.key, rarity, tier) ?? 0),
  }))
}

/**
 * Whether two checked texts tell the same rolls: equal, or one of them `~`
 * and every line holding the same tiers in the same order in both (the `~`
 * one only knows less of the order). Two different ordered texts disagree:
 * each states the order across lines.
 */
export function rollsAgree(a: RollsText, b: RollsText): boolean {
  if (a === b) return true
  if (!isRollsText(a) || !isRollsText(b)) return false
  if (rollsOrdered(a) && rollsOrdered(b)) return false
  // Ten lines: every digit a line can be, so no pair is left out.
  const x = rollsByLine(a, 10)
  const y = rollsByLine(b, 10)
  return x.every(
    (tiers, line) => tiers.length === y[line]!.length && tiers.every((t, i) => t === y[line]![i]),
  )
}

/**
 * The one rule for writing `incoming` rolls onto a catalog entry that holds
 * `stored` (both already checked against the piece): true when the entry
 * has none and `incoming` is a RollsText; true when `stored` is a `~` text,
 * `incoming` is ordered and every line holds the same tiers in the same
 * order; false otherwise. Stored ordered rolls are never overwritten.
 */
export function needsFill(stored: RollsText | undefined, incoming: RollsText | undefined): boolean {
  if (!isRollsText(incoming)) return false
  if (stored === undefined) return true
  if (!isRollsText(stored) || rollsOrdered(stored) || !rollsOrdered(incoming)) return false
  const a = rollsByLine(stored, 10)
  const b = rollsByLine(incoming, 10)
  return a.every(
    (tiers, line) => tiers.length === b[line]!.length && tiers.every((t, i) => t === b[line]![i]),
  )
}
