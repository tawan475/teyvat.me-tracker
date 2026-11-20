import { describe, expect, it } from 'vitest'
import { compareVersions, routeOf, weekStart } from '../src/insights'

describe('compareVersions', () => {
  it('compares number by number, not as text', () => {
    expect(compareVersions('1.18.1', '1.18.0')).toBe(1)
    expect(compareVersions('1.18.0', '1.18.1')).toBe(-1)
    expect(compareVersions('1.18.1', '1.18.1')).toBe(0)
    // As text "1.9" sorts after "1.18".
    expect(compareVersions('1.18.0', '1.9.0')).toBe(1)
    expect(compareVersions('1.17.32', '1.17.4')).toBe(1)
  })

  it('reads the old running release numbers the same way', () => {
    // As text "T-10" sorts before "T-9" (why the updater once missed a release).
    expect(compareVersions('0.2.2-T-10', '0.2.2-T-9')).toBe(1)
    expect(compareVersions('0.2.4-T-19', '0.2.3-T-11')).toBe(1)
  })

  it('takes the longer of two equal starts as the newer', () => {
    expect(compareVersions('1.18', '1.18.1')).toBe(-1)
    expect(compareVersions('1.18.1', '1.18')).toBe(1)
  })
})

describe('routeOf', () => {
  it('folds ids and long tokens, so one route is one row', () => {
    expect(routeOf('/api/accounts/12/bundle')).toBe('/api/accounts/:id/bundle')
    expect(routeOf('/api/accounts/7/bundle')).toBe('/api/accounts/:id/bundle')
    expect(routeOf('/api/irminsul/changes')).toBe('/api/irminsul/changes')
    expect(routeOf('/api/auth/verify/0123456789abcdef0123456789abcdef')).toBe(
      '/api/auth/verify/:id',
    )
    // A long route name of ours is not an id.
    expect(routeOf('/api/genshin-accounts-public/import-by-key')).toBe(
      '/api/genshin-accounts-public/import-by-key',
    )
  })
})

describe('weekStart', () => {
  it('is the Monday of the week, in UTC', () => {
    // 2026-11-20 is a Friday.
    expect(weekStart(Date.UTC(2026, 10, 20, 15))).toBe('2026-11-16')
    expect(weekStart(Date.UTC(2026, 10, 16))).toBe('2026-11-16')
    // A Sunday belongs to the week that began six days before.
    expect(weekStart(Date.UTC(2026, 10, 22, 23, 59))).toBe('2026-11-16')
    expect(weekStart(Date.UTC(2026, 10, 23))).toBe('2026-11-23')
    // Across a year's end.
    expect(weekStart(Date.UTC(2027, 0, 1))).toBe('2026-12-28')
  })
})
