/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import bumpFile from '../../../../../.github/workflows/game-data-bump.yml?raw'
import smokeFile from '../../../../../.github/workflows/self-host.yml?raw'
import pinScript from '../../../../../self-host/pin-game-data.mjs?raw'
import {
  PUBLIC_REPO,
  PUBLIC_URL,
  hasTag,
  lsRemoteArgs,
  pinnedTag,
  privateSpec,
  publicSpec,
  smokeGate,
} from '../../../../../self-host/public-game-data.mjs'
import tracker from '../../../package.json'

/**
 * When a game data bump starts the self-host smoke test (issue 12): only
 * while the repository variable SELF_HOST_SMOKE is 1 and the public game data
 * has the tag the bump pinned; otherwise a quiet skip. It runs as a workflow
 * run of its own, started by a job that can do nothing else.
 */

const SHA = '0123456789abcdef0123456789abcdef01234567'
const PINNED = 'github:tawan475/genshin-game-data#v7.2.7'
/** `git ls-remote --tags --refs` output: one `<sha>\t<ref>` line per tag. */
const refs = (...tags: string[]) => tags.map((tag) => `${SHA}\trefs/tags/${tag}\n`).join('')

describe('the tag the tracker pins', () => {
  it('is read from the private game data spec, and from nothing else', () => {
    expect(pinnedTag(PINNED)).toBe('v7.2.7')
    expect(pinnedTag(privateSpec('v7.3.12'))).toBe('v7.3.12')
    expect(pinnedTag('github:tawan475/genshin-game-data#v7.2.7-s1')).toBe('v7.2.7-s1')
    // What this checkout pins is one.
    expect(pinnedTag(tracker.dependencies['@gdt/game-data'])).toMatch(/^v\d+\.\d+\.\d+/)
    for (const spec of [
      '',
      null,
      undefined,
      'github:tawan475/genshin-game-data',
      'github:tawan475/genshin-game-data#main',
      'github:tawan475/genshin-game-data#v7.2.7 --upload-pack=x',
      'github:tawan475/genshin-game-data#v7.2.7#v1',
      'github:someone/genshin-game-data#v7.2.7',
      publicSpec('v7.2.7'),
      'git+file:///C:/work/genshin-game-data#v7.1.0',
      '^7.2.7',
    ])
      expect(pinnedTag(spec)).toBeNull()
  })

  it('names the public copy at the same tag, as the image build pins it', () => {
    expect(PUBLIC_REPO).toBe('tawan475/teyvat.me-game-data')
    expect(publicSpec('v7.2.7')).toBe('github:tawan475/teyvat.me-game-data#v7.2.7')
    // The Dockerfile's pin script and the gate read the pin with one function.
    expect(pinScript).toContain("from './public-game-data.mjs'")
    expect(pinScript).toContain('pinnedTag(pinned)')
    expect(pinScript).toContain('publicSpec(tag)')
  })
})

describe("the public copy's tags", () => {
  it('are asked for by name, with no shell and no token', () => {
    expect(PUBLIC_URL).toBe('https://github.com/tawan475/teyvat.me-game-data.git')
    expect(lsRemoteArgs('v7.2.7')).toEqual([
      'ls-remote',
      '--tags',
      '--refs',
      PUBLIC_URL,
      'refs/tags/v7.2.7',
    ])
  })

  it('hold the tag only when a line names exactly it', () => {
    expect(hasTag(refs('v7.2.7'), 'v7.2.7')).toBe(true)
    expect(hasTag(refs('v7.2.6', 'v7.2.7', 'v7.2.8'), 'v7.2.7')).toBe(true)
    expect(hasTag(refs('v7.2.7').replace(/\n/g, '\r\n'), 'v7.2.7')).toBe(true)
    // Nothing yet (the copy has no tags), or only its neighbours.
    expect(hasTag('', 'v7.2.7')).toBe(false)
    expect(hasTag(refs('v7.2.70', 'v7.2.7-s1', 'v7.2', 'xv7.2.7'), 'v7.2.7')).toBe(false)
    // A branch of that name, a peeled tag line, or words that are no ref line.
    expect(hasTag(`${SHA}\trefs/heads/v7.2.7\n`, 'v7.2.7')).toBe(false)
    expect(hasTag(`${SHA}\trefs/tags/v7.2.7^{}\n`, 'v7.2.7')).toBe(false)
    expect(hasTag('warning: refs/tags/v7.2.7\n', 'v7.2.7')).toBe(false)
    expect(hasTag(`${SHA}\trefs/tags/v7.2.7 extra\n`, 'v7.2.7')).toBe(false)
  })
})

describe('starting the smoke test after a bump', () => {
  it('needs the variable at exactly 1 and the pinned tag on the public copy', () => {
    expect(smokeGate({ variable: '1', spec: PINNED, lsRemote: refs('v7.2.7') })).toEqual({
      run: true,
      tag: 'v7.2.7',
      reason: 'tawan475/teyvat.me-game-data has v7.2.7',
    })
  })

  it('skips while the variable is anything else, whatever the tags say', () => {
    for (const variable of [undefined, null, '', '0', 'true', '1 ', ' 1', '11'])
      expect(smokeGate({ variable, spec: PINNED, lsRemote: refs('v7.2.7') })).toMatchObject({
        run: false,
        reason: expect.stringContaining('SELF_HOST_SMOKE'),
      })
  })

  it('skips while the public copy lacks the tag, or could not be asked', () => {
    expect(smokeGate({ variable: '1', spec: PINNED, lsRemote: '' })).toEqual({
      run: false,
      tag: 'v7.2.7',
      reason: 'tawan475/teyvat.me-game-data has no tag v7.2.7 yet',
    })
    expect(smokeGate({ variable: '1', spec: PINNED, lsRemote: refs('v7.2.6') })).toMatchObject({
      run: false,
    })
    expect(smokeGate({ variable: '1', spec: PINNED, lsRemote: null })).toMatchObject({
      run: false,
      tag: 'v7.2.7',
      reason: expect.stringContaining('could not ask'),
    })
  })

  it('skips when the tracker pins no release tag', () => {
    for (const spec of ['', undefined, 'github:tawan475/genshin-game-data#main'])
      expect(smokeGate({ variable: '1', spec, lsRemote: refs('v7.2.7') })).toMatchObject({
        run: false,
        tag: null,
      })
  })
})

describe('the workflows', () => {
  // The repository keeps these with CRLF on Windows checkouts; read them as LF.
  const bump = bumpFile.replace(/\r\n/g, '\n')
  const smoke = smokeFile.replace(/\r\n/g, '\n')
  /** A top-level job's block: from its name to the next job (or the end). */
  const job = (name: string) => {
    const start = bump.indexOf(`\n  ${name}:\n`)
    expect(start).toBeGreaterThan(-1)
    const rest = bump.slice(start + 1)
    const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/)
    return next === -1 ? rest : rest.slice(0, next + 2)
  }

  it('start the smoke test as a run of its own, never as a job of the bump', () => {
    expect(bump).not.toMatch(/uses:\s*\.\/\.github\/workflows\/self-host\.yml/)
    expect(smoke).not.toContain('workflow_call')
    const selfHost = job('self-host')
    expect(selfHost).toContain('gh workflow run self-host.yml')
    expect(selfHost).toContain('-f "ref=$SHA"')
    // The smoke test takes that commit, by hand too.
    expect(smoke).toMatch(/workflow_dispatch:\n {4}inputs:\n {6}ref:/)
    expect(smoke).toContain('ref: ${{ inputs.ref || github.sha }}')
  })

  it('give the starting job actions: write and nothing else', () => {
    const selfHost = job('self-host')
    const permissions = /\n {4}permissions:\n((?: {6}.*\n)+)/.exec(selfHost)?.[1]
    expect(permissions).toBe('      actions: write\n')
    // No checkout and no secret in a job whose token can start workflows.
    expect(selfHost).not.toContain('uses:')
    expect(selfHost).not.toContain('secrets.')
    // The deploy is called (deploy.yml), never dispatched: one dispatch in all.
    const commands = bump.split('\n').filter((line) => !line.trim().startsWith('#'))
    expect(commands.filter((line) => line.includes('gh workflow run'))).toHaveLength(1)
  })

  it('gate it on the variable and the public tag, without failing the bump', () => {
    const selfHost = job('self-host')
    const condition = /\n {4}if: (.*)\n/.exec(selfHost)?.[1] ?? ''
    expect(condition).toContain("needs.bump.outputs.merged == 'true'")
    expect(condition).toContain("vars.SELF_HOST_SMOKE == '1'")
    expect(condition).toContain("needs.bump.outputs.smoke == 'true'")
    expect(condition).not.toContain('||')
    const bumpJob = job('bump')
    expect(bumpJob).toContain('smoke: ${{ steps.smoke.outputs.run }}')
    const step = /\n {6}- name: Self-host smoke test wanted\n((?: {8}.*\n)+)/.exec(bumpJob)?.[1]
    expect(step).toContain('id: smoke')
    expect(step).toContain(
      "if: steps.merge.outputs.merged == 'true' && vars.SELF_HOST_SMOKE == '1'",
    )
    expect(step).toContain('continue-on-error: true')
    expect(step).toContain('run: node self-host/smoke-gate.mjs "$TAG"')
    // The deploy waits for the bump alone.
    expect(job('deploy')).toMatch(/\n {4}needs: bump\n/)
  })
})
