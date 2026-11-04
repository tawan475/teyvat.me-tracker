import { describe, expect, it } from 'vitest'
import { parseRunKey, runKey, runRowKey } from '../wish-run-key'

describe('a banner run in a URL', () => {
  it('names a run by kind, start and name and reads it back, names with colons included', () => {
    const run = { kind: 'character' as const, start: 1793750400, name: 'Myriad Patterns: Unfold' }
    expect(runKey(run)).toBe('character:1793750400:Myriad Patterns: Unfold')
    expect(parseRunKey(runKey(run))).toEqual(run)
    expect(runRowKey(run)).toBe('1793750400:Myriad Patterns: Unfold')
  })

  it('refuses anything that is not a run', () => {
    expect(parseRunKey(null)).toBeNull()
    expect(parseRunKey('')).toBeNull()
    expect(parseRunKey('standard:1:x')).toBeNull()
    expect(parseRunKey('weapon:soon:Epitome Invocation')).toBeNull()
  })
})
