/**
 * The public game data files for API clients (docs/plans/public-api.md §7):
 * `/data/v1/manifest.json` and per language characters, weapons, materials,
 * artifact sets and achievements, plus the banners. Written into the client
 * build after `vite build` (they are static assets: free to serve, never
 * counted), from the pinned `@gdt/game-data` release.
 *
 * Raw data: GOOD keys and game ids, names in that language, rarities, and
 * each picture as a full URL by the data's own rule (nanoka, else gi-cdn,
 * else null). No game art is stored here.
 *
 *   tsx scripts/game-data-files.ts [outDir]   (default dist/client)
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GAME_DATA,
  achievementText,
  loadAchievements,
  loadArtifactNames,
  loadGameNames,
  loadImageCoverage,
  loadMaterialIndex,
  loadMaterialNames,
  type Language,
} from '@gdt/game-data'
import { CHARACTER_KEYS, WEAPON_KEYS, characterInfo, weaponInfo } from '@gdt/game-data/catalog'
import { artifactImage, characterImages, weaponImages } from '@gdt/game-data/images'
import { imageUrlOf } from '@gdt/game-data/image-url'
import { SITE_LANGUAGES } from '@gdt/shared/settings'
import banners from '../src/data/wish-banners.json'

const out = process.argv[2] ?? fileURLToPath(new URL('../dist/client', import.meta.url))
const base = join(out, 'data', 'v1')
const require = createRequire(import.meta.url)
const gameDataDir = join(require.resolve('@gdt/game-data/package.json'), '..')
const rawMaterials = JSON.parse(
  readFileSync(join(gameDataDir, 'data', 'materials.json'), 'utf8'),
) as {
  materials: Record<string, unknown>
}
const rawNames = JSON.parse(
  readFileSync(join(gameDataDir, 'data', 'text', 'names-en.json'), 'utf8'),
) as {
  sets: Record<string, string>
}

const SLOTS = ['flower', 'plume', 'sands', 'goblet', 'circlet'] as const

const coverage = await loadImageCoverage()
const url = (name: string | undefined) => imageUrlOf(name, coverage) || null
const index = await loadMaterialIndex()
const achievements = await loadAchievements()

const files: { path: string; hash: string; bytes: number }[] = []
function write(path: string, value: unknown) {
  const text = `${JSON.stringify(value)}\n`
  mkdirSync(join(base, path, '..'), { recursive: true })
  writeFileSync(join(base, path), text)
  files.push({
    path,
    hash: createHash('sha256').update(text).digest('hex').slice(0, 16),
    bytes: Buffer.byteLength(text),
  })
}

for (const lang of SITE_LANGUAGES as readonly Language[]) {
  const names = await loadGameNames(lang)
  const materialNames = await loadMaterialNames(lang)
  const artifactNames = await loadArtifactNames(lang)
  const text = await achievementText(lang)

  write(
    `${lang}/characters.json`,
    CHARACTER_KEYS.map((key) => {
      const info = characterInfo(key)
      return {
        key,
        name: names.name('characters', key) ?? key,
        rarity: info?.rarity ?? null,
        element: info?.element ?? null,
        weapon: info?.weapon ?? null,
        region: info?.region ?? null,
        icon: url(characterImages(key)?.icon),
      }
    }),
  )
  write(
    `${lang}/weapons.json`,
    WEAPON_KEYS.map((key) => {
      const info = weaponInfo(key)
      return {
        key,
        name: names.name('weapons', key) ?? key,
        rarity: info?.rarity ?? null,
        type: info?.type ?? null,
        id: info?.id ?? null,
        maxLevel: info?.maxLevel ?? null,
        icon: url(weaponImages(key)?.[0]),
      }
    }),
  )
  write(
    `${lang}/materials.json`,
    Object.keys(rawMaterials.materials)
      .filter((key) => index.has(key))
      .map((key) => ({
        key,
        name: materialNames.name(key) ?? key,
        rarity: index.rarity(key) ?? null,
        id: index.id(key) ?? null,
        icon: url(index.icon(key)),
      })),
  )
  write(
    `${lang}/artifact-sets.json`,
    Object.keys(rawNames.sets).map((key) => ({
      key,
      name: names.name('sets', key) ?? key,
      pieces: Object.fromEntries(
        SLOTS.flatMap((slot) => {
          const image = artifactImage(key, slot)
          const name = artifactNames.name(key, slot)
          return image || name ? [[slot, { name: name ?? null, icon: url(image) }]] : []
        }),
      ),
    })),
  )
  write(`${lang}/achievements.json`, {
    categories: achievements.goals.map((goal) => ({
      id: goal.id,
      name: text.goals.get(goal.id) ?? null,
      order: goal.order,
      icon: url(goal.icon),
    })),
    achievements: achievements.achievements.map((a) => ({
      id: a.id,
      category: a.goal,
      order: a.order,
      title: text.achievements.get(a.id)?.title ?? null,
      description: text.achievements.get(a.id)?.description ?? null,
      primogems: a.primogems,
      progress: a.progress,
      hidden: a.hidden,
      version: a.version || null,
      previous: a.prevStage || null,
      disused: a.disused,
    })),
  })
}

// Event wishes (English names, UTC+8 times as paimon.moe's data writes them).
write('banners.json', banners)

const manifest = {
  version: 1,
  gameData: GAME_DATA.version,
  gameVersion: GAME_DATA.gameVersion,
  languages: SITE_LANGUAGES,
  files,
}
writeFileSync(join(base, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`game data files: ${files.length} under ${base}`)
