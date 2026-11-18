// Points apps/tracker's @gdt/game-data at the public copy of the game data,
// tawan475/teyvat.me-game-data, at the tag the tracker pins (teyvat.me itself
// builds from the private tawan475/genshin-game-data; the public copy's tags
// mirror its tags). Run by self-host/Dockerfile before `pnpm install`.
//
//   node self-host/pin-game-data.mjs [<pnpm spec>]
//
// A spec given (the Dockerfile's GAME_DATA build argument: a fork, a tarball
// URL) is used as is instead.

import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../apps/tracker/package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(file, 'utf8'))
const pinned = pkg.dependencies?.['@gdt/game-data'] ?? ''
const tag = /^github:tawan475\/genshin-game-data#(v[0-9][^\s#]*)$/.exec(pinned)?.[1]

const given = process.argv[2]?.trim()
if (!given && !tag) {
  console.error(
    `apps/tracker pins @gdt/game-data to "${pinned}", not a genshin-game-data tag: pass GAME_DATA`,
  )
  process.exit(1)
}
const spec = given || `github:tawan475/teyvat.me-game-data#${tag}`
pkg.dependencies['@gdt/game-data'] = spec
writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
console.log(`game data: ${spec}`)
