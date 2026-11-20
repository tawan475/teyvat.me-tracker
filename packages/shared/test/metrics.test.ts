import { describe, expect, it } from 'vitest'
import {
  USAGE_BASE_USD,
  USAGE_KEYS,
  USAGE_PLAN,
  clientName,
  clientProgram,
  linePoints,
  usageBill,
  type UsageItem,
} from '../src/metrics'

describe('clientProgram', () => {
  it("tells Teyvat.me's two programs apart by the platform a heartbeat reports", () => {
    expect(clientProgram('teyvatme', 'Teyvat.me on EXAMPLE1', 'windows')).toBe('teyvat.me-desktop')
    expect(clientProgram('teyvatme', 'Teyvat.me on EXAMPLE1', 'linux')).toBe('teyvat.me-desktop')
    expect(clientProgram('teyvatme', 'Teyvat.me on Pixel 8', 'android')).toBe('teyvat.me-android')
    // Not heard from: which of the two is not known.
    expect(clientProgram('teyvatme', 'Teyvat.me on EXAMPLE1', null)).toBe('teyvat.me')
  })

  it('reads a sign-in from before the name was kept by its label', () => {
    expect(clientProgram(null, 'Teyvat.me on EXAMPLE1', 'android')).toBe('teyvat.me-android')
    expect(clientProgram(null, 'Irminsul on EXAMPLE1', 'windows')).toBe('irminsul')
    expect(clientProgram(undefined, null, null)).toBe('irminsul')
  })

  it("keeps another client's own name, whatever its platform", () => {
    expect(clientProgram('other-client', 'Irminsul on EXAMPLE1', 'windows')).toBe('other-client')
    expect(clientProgram('other-client', null, 'android')).toBe('other-client')
    expect(clientProgram('irminsul', null, 'windows')).toBe('irminsul')
  })
})

describe('clientName', () => {
  it('keeps plain names, lowercased, and nothing else', () => {
    expect(clientName('teyvatme')).toBe('teyvatme')
    expect(clientName(' My.Client-2 ')).toBe('my.client-2')
    expect(clientName('a'.repeat(32))).toBe('a'.repeat(32))
    expect(clientName('a'.repeat(33))).toBeNull()
    expect(clientName('')).toBeNull()
    expect(clientName('-leading')).toBeNull()
    expect(clientName('two words')).toBeNull()
    expect(clientName('<b>')).toBeNull()
    expect(clientName(42)).toBeNull()
    expect(clientName(undefined)).toBeNull()
  })
})

describe('usageBill', () => {
  const items = (used: Partial<Record<UsageItem['key'], number | null>>): UsageItem[] =>
    USAGE_KEYS.map((key) => ({
      key,
      used: used[key] === undefined ? 0 : used[key]!,
      included: USAGE_PLAN[key].included,
    }))

  it('is the base price while everything is inside what the plan includes', () => {
    expect(usageBill(items({}))).toBe(USAGE_BASE_USD)
    expect(usageBill(items({ requests: 10_000_000, cpuMs: 30_000_000 }))).toBe(USAGE_BASE_USD)
  })

  it('adds only the part over, at each list price, and skips unknown figures', () => {
    // 2M requests over = $0.60; 10M CPU ms over = $0.20; 1M rows written over = $1.
    expect(
      usageBill(
        items({ requests: 12_000_000, cpuMs: 40_000_000, d1Written: 51_000_000, d1Read: null }),
      ),
    ).toBe(6.8)
    // Carried to the month's end: twice the usage.
    expect(usageBill(items({ requests: 6_000_000 }), 2)).toBe(5.6)
  })
})

describe('linePoints', () => {
  it('spreads the values across the box, the largest at the top', () => {
    expect(linePoints([0, 5, 10], 10, 100, 30)).toBe('0,29 50,15 100,1')
    expect(linePoints([4], 4, 100, 30)).toBe('50,1')
    expect(linePoints([], 4)).toBe('')
    // A flat zero line stays on the floor.
    expect(linePoints([0, 0], 0, 100, 30)).toBe('0,29 100,29')
  })
})
