// Whether a game data bump starts the self-host smoke test (the last step of
// game-data-bump.yml's bump job; the rule is public-game-data.mjs `smokeGate`):
//
//   SELF_HOST_SMOKE=1 node self-host/smoke-gate.mjs [<tag>]
//
// Takes the tag the bump just pinned (the workflow passes it: after its merge
// the checkout may be on another commit), or without one reads what this
// checkout's apps/tracker pins. Asks the public game data repository for the
// tag with `git ls-remote` (no token: it is public), prints the answer and
// writes `run=true|false` and `tag=` to $GITHUB_OUTPUT. It always exits 0:
// whatever goes wrong here is a skipped smoke test, never a failed bump.

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { lsRemoteArgs, pinnedTag, privateSpec, smokeGate } from './public-game-data.mjs'

/** What this checkout's apps/tracker pins the game data to. */
function checkedOutSpec() {
  const pkg = JSON.parse(
    readFileSync(new URL('../apps/tracker/package.json', import.meta.url), 'utf8'),
  )
  return pkg.dependencies?.['@gdt/game-data'] ?? ''
}

let gate
try {
  const given = process.argv[2]?.trim()
  const spec = given ? privateSpec(given) : checkedOutSpec()
  const variable = process.env.SELF_HOST_SMOKE ?? ''
  const tag = pinnedTag(spec)
  let lsRemote = null
  if (variable === '1' && tag) {
    try {
      lsRemote = execFileSync('git', lsRemoteArgs(tag), {
        encoding: 'utf8',
        timeout: 60_000,
        stdio: ['ignore', 'pipe', 'pipe'],
        // Never wait for a name and password (a repository gone private or renamed).
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      })
    } catch (cause) {
      console.log(`git ls-remote failed: ${String(cause?.message ?? cause).trim()}`)
    }
  }
  gate = smokeGate({ variable, spec, lsRemote })
} catch (cause) {
  gate = { run: false, tag: null, reason: `could not decide: ${String(cause?.message ?? cause)}` }
}

console.log(`self-host smoke test: ${gate.run ? 'start' : 'skip'} (${gate.reason})`)
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `run=${gate.run}\ntag=${gate.tag ?? ''}\n`)
}
