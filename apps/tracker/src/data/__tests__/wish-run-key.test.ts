import { describe, expect, it } from 'vitest'
import { parseWishTime } from '@gdt/shared'
import bannerFile from '../wish-banners.json'
import { eventBanners, type BannerFile } from '../wish-history'
import { parseRunKey, runKey, runRowKey } from '../wish-run-key'

describe('a banner run in a URL', () => {
  it('names a run by kind, start and name and reads it back, names with colons included', () => {
    const run = { kind: 'character' as const, start: 1793750400, name: 'Myriad Patterns: Unfold' }
    expect(runKey(run)).toBe('character:1793750400:Myriad Patterns: Unfold')
    expect(parseRunKey(runKey(run))).toEqual(run)
    expect(runRowKey(run)).toBe('1793750400:Myriad Patterns: Unfold')
  })

  it('names a run the same on every server, as Asia accounts always did', () => {
    const keys = [8, 1, -5].map((tz) =>
      eventBanners(bannerFile as unknown as BannerFile, tz)
        .get('character')!
        .filter((b) => b.version === '7.1')
        .map(runKey),
    )
    const vesna = parseWishTime('2026-09-23 06:00:00')! - 8 * 3600
    const skirk = parseWishTime('2026-10-13 18:00:00')! - 8 * 3600
    expect(keys[0]).toEqual([
      `character:${vesna}:When Warm Winds Cavort`,
      `character:${skirk}:Void Star's Advent`,
    ])
    expect(keys[1]).toEqual(keys[0])
    expect(keys[2]).toEqual(keys[0])
  })

  it('refuses anything that is not a run', () => {
    expect(parseRunKey(null)).toBeNull()
    expect(parseRunKey('')).toBeNull()
    expect(parseRunKey('standard:1:x')).toBeNull()
    expect(parseRunKey('weapon:soon:Epitome Invocation')).toBeNull()
  })
})
