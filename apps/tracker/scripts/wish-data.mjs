#!/usr/bin/env node
/**
 * Regenerates the wish history's static data from a paimon.moe checkout
 * (https://github.com/MadeBaruna/paimon-moe, MIT, (c) Made Baruna) and the
 * installed @gdt/game-data:
 *
 * - packages/shared/src/wish/items.json: every wishable character and weapon
 *   as [GOOD key, English name, rarity, game item id]. Keys, rarities and
 *   ids come from the game data; the English names from paimon.moe's
 *   characters.js / weaponList.js, matched by toGoodKey(name). A key without
 *   a paimon.moe name gets its key spelled out (and the script says so).
 * - apps/tracker/src/data/wish-banners.json: the event banners (character,
 *   weapon, chronicled) with their dates and featured items as GOOD keys,
 *   adapted from paimon.moe's banners.js (dual banners: bannersDual.js).
 *
 *   node apps/tracker/scripts/wish-data.mjs <path to paimon-moe checkout>
 *
 * New banners: pull paimon.moe, run this, review the diff (a featured item
 * the script cannot map is printed and left out). Or append an entry by
 * hand: the JSON is plain data, newest last.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const tracker = resolve(here, '..')
const paimon = process.argv[2]
if (!paimon) {
  console.error('usage: node scripts/wish-data.mjs <paimon-moe checkout>')
  process.exit(1)
}

const toGoodKey = (name) =>
  name
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')

// paimon.moe's data modules import each other without the `.js` (Vite resolves it).
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[cm]?js$/.test(specifier) && context.parentURL) {
      const url = new URL(`${specifier}.js`, context.parentURL)
      if (existsSync(fileURLToPath(url))) return next(url.href, context)
    }
    return next(specifier, context)
  },
})

const load = (file) => import(pathToFileURL(join(paimon, 'src/data', file)).href)
const { characters } = await load('characters.js')
const { weaponList } = await load('weaponList.js')
const { banners } = await load('banners.js')
const { bannersDual } = await load('bannersDual.js')

const planner = JSON.parse(
  readFileSync(join(tracker, 'node_modules/@gdt/game-data/data/planner.json'), 'utf8'),
)
const column = (kind, name) => planner.columns[kind].indexOf(name)

/** paimon.moe id → GOOD key, and GOOD key → English name. */
const paimonKey = new Map()
const names = new Map()
for (const list of [characters, weaponList]) {
  for (const entry of Object.values(list)) {
    const key = toGoodKey(entry.name)
    paimonKey.set(entry.id, key)
    paimonKey.set(entry.id.replace(/-/g, '_'), key)
    if (!names.has(key)) names.set(key, entry.name)
  }
}

const spell = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
const unnamed = []
function rows(kind, keep) {
  const [k, id, rarity] = ['key', 'id', 'rarity'].map((c) => column(kind, c))
  return planner[kind]
    .filter((row) => keep(row[k], row[rarity]))
    .map((row) => {
      const name = names.get(row[k])
      if (!name) unnamed.push(row[k])
      return [row[k], name ?? spell(row[k]), row[rarity], row[id]]
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

const items = {
  characters: rows('characters', (key) => !/^Traveler|^Manekin/.test(key) && key !== 'Traveler'),
  weapons: rows('weapons', (_key, rarity) => rarity >= 3),
}

const unmapped = new Set()
const keys = (ids) =>
  ids
    .map((id) => {
      const key = paimonKey.get(id) ?? paimonKey.get(id.replace(/-/g, '_'))
      if (!key) unmapped.add(id)
      return key
    })
    .filter(Boolean)

/**
 * Banner times as paimon.moe writes them, with its `timezoneDependent`
 * flag (a version's first banners). What the flag means for each server's
 * clock is `eventBanners` in src/data/wish-history.ts.
 */
const banner = (kind) => (b) => [
  kind,
  b.start,
  b.end,
  b.timezoneDependent ? 1 : 0,
  keys(b.featured ?? []),
  keys(b.featuredRare ?? []),
  b.version ?? '',
  b.name ?? '',
  // A dual phase's second character banner (gacha_type 400).
  (kind === 'character' && bannersDual[`${b.name} ${b.image}`]?.[1]?.name) || '',
]
const out = {
  attribution:
    'Banner dates and featured items adapted from paimon.moe (https://github.com/MadeBaruna/paimon-moe), MIT License, Copyright (c) Made Baruna. Regenerate with apps/tracker/scripts/wish-data.mjs.',
  columns: [
    'kind',
    'start',
    'end',
    'serverTime',
    'featured5',
    'featured4',
    'version',
    'name',
    'name400',
  ],
  banners: [
    ...banners.characters.map(banner('character')),
    ...banners.weapons.map(banner('weapon')),
    ...(banners.chronicled ?? []).map(banner('chronicled')),
  ],
}

/** One row per line, so a regeneration's diff shows what changed. */
const rowsJson = (object) =>
  '{\n' +
  Object.entries(object)
    .map(([name, value]) =>
      Array.isArray(value) && Array.isArray(value[0])
        ? `  ${JSON.stringify(name)}: [\n${value.map((row) => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]`
        : `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`,
    )
    .join(',\n') +
  '\n}\n'
writeFileSync(resolve(tracker, '../../packages/shared/src/wish/items.json'), rowsJson(items))
writeFileSync(join(tracker, 'src/data/wish-banners.json'), rowsJson(out))
console.log(
  `items: ${items.characters.length} characters, ${items.weapons.length} weapons; banners: ${out.banners.length}`,
)
if (unnamed.length) console.log('no paimon.moe name (spelled from the key):', unnamed.join(', '))
if (unmapped.size)
  console.log('featured ids with no GOOD key (left out):', [...unmapped].join(', '))
