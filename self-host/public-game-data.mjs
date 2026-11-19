// The public copy of the game data, tawan475/teyvat.me-game-data: its tags
// mirror the private tawan475/genshin-game-data's (teyvat.me builds from the
// private one, a self-host's image from the public one at the same tag).
// Pure: read by pin-game-data.mjs (the Dockerfile), by smoke-gate.mjs (the
// game data bump workflow) and by the tracker's tests.

export const PUBLIC_REPO = 'tawan475/teyvat.me-game-data'
export const PUBLIC_URL = `https://github.com/${PUBLIC_REPO}.git`

/** The release tag a pnpm spec of the private game data pins; null: it pins something else. */
export function pinnedTag(spec) {
  return /^github:tawan475\/genshin-game-data#(v[0-9][^\s#]*)$/.exec(spec ?? '')?.[1] ?? null
}

/** The pnpm spec that pins the private game data to a tag (what the bump workflow writes). */
export const privateSpec = (tag) => `github:tawan475/genshin-game-data#${tag}`

/** The pnpm spec of the public copy at a tag. */
export const publicSpec = (tag) => `github:${PUBLIC_REPO}#${tag}`

/** `git` arguments that ask the public copy for one tag. */
export const lsRemoteArgs = (tag) => [
  'ls-remote',
  '--tags',
  '--refs',
  PUBLIC_URL,
  `refs/tags/${tag}`,
]

/**
 * Whether `git ls-remote --tags --refs` output lists exactly this tag (a
 * pattern can match more: `v7.2.7` is not `v7.2.70` or `v7.2.7-s1`).
 */
export function hasTag(lsRemote, tag) {
  return lsRemote.split(/\r?\n/).some((line) => {
    const fields = line.trim().split(/\s+/)
    return (
      fields.length === 2 && /^[0-9a-f]{40,64}$/.test(fields[0]) && fields[1] === `refs/tags/${tag}`
    )
  })
}

/**
 * Whether a game data bump starts the self-host smoke test: only while the
 * repository variable SELF_HOST_SMOKE is exactly `1` and the public copy has
 * the tag the tracker pins (before that the image cannot build, and every run
 * would open the `self-host` issue). Anything else is a quiet skip.
 *
 * `variable`: SELF_HOST_SMOKE as set (or absent); `spec`: apps/tracker's
 * `@gdt/game-data` dependency; `lsRemote`: what `git ls-remote` (lsRemoteArgs)
 * printed, null when it could not ask.
 */
export function smokeGate({ variable, spec, lsRemote }) {
  const skip = (reason, tag = null) => ({ run: false, tag, reason })
  if (variable !== '1') return skip('the repository variable SELF_HOST_SMOKE is not 1')
  const tag = pinnedTag(spec)
  if (!tag) return skip(`apps/tracker pins @gdt/game-data to "${spec ?? ''}", not a release tag`)
  if (typeof lsRemote !== 'string') return skip(`could not ask ${PUBLIC_REPO} for its tags`, tag)
  if (!hasTag(lsRemote, tag)) return skip(`${PUBLIC_REPO} has no tag ${tag} yet`, tag)
  return { run: true, tag, reason: `${PUBLIC_REPO} has ${tag}` }
}
