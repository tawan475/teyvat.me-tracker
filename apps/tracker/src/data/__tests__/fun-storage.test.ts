import { describe, expect, it } from 'vitest'
import { funStateKey, oldFunStateKey, readDeviceWide, type FunStore } from '../fun-storage'

function store(entries: Record<string, string> = {}): FunStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(entries))
  return {
    data,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => void data.set(key, value),
  }
}

describe('Fun state kept per device', () => {
  it('names one key per page, and the old per-account one', () => {
    expect(funStateKey('wheel')).toBe('fun:wheel')
    expect(oldFunStateKey('boss', 12)).toBe('fun:boss:12')
    expect(oldFunStateKey('cards', -1)).toBe('fun:cards:-1')
  })

  it('reads the device-wide value first, never touching the old ones', () => {
    const s = store({ 'fun:wheel': '{"text":"a"}', 'fun:wheel:12': '{"text":"old"}' })
    expect(readDeviceWide(s, 'wheel', 12)).toBe('{"text":"a"}')
    expect(s.data.get('fun:wheel')).toBe('{"text":"a"}')
    expect(s.data.get('fun:wheel:12')).toBe('{"text":"old"}')
  })

  it("copies the current account's old value when there is no device-wide one", () => {
    const s = store({ 'fun:boss:12': '{"benched":["x"]}', 'fun:boss:13': '{"benched":["y"]}' })
    expect(readDeviceWide(s, 'boss', 12)).toBe('{"benched":["x"]}')
    expect(s.data.get('fun:boss')).toBe('{"benched":["x"]}')
    // The old keys stay as they were.
    expect(s.data.get('fun:boss:12')).toBe('{"benched":["x"]}')
    // Once copied, another account reads the device-wide value, not its own old one.
    expect(readDeviceWide(s, 'boss', 13)).toBe('{"benched":["x"]}')
  })

  it('has nothing on the public page without a device-wide value', () => {
    const s = store({ 'fun:cards:12': '{"count":4}' })
    expect(readDeviceWide(s, 'cards', null)).toBeNull()
    expect(s.data.has('fun:cards')).toBe(false)
  })

  it('has nothing when neither value exists, and writes nothing', () => {
    const s = store()
    expect(readDeviceWide(s, 'wheel', 5)).toBeNull()
    expect(s.data.size).toBe(0)
  })

  it('keeps each page apart', () => {
    const s = store({ 'fun:wheel:5': 'w' })
    expect(readDeviceWide(s, 'boss', 5)).toBeNull()
    expect(readDeviceWide(s, 'wheel', 5)).toBe('w')
  })
})
