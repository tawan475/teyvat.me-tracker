import { describe, expect, it } from 'vitest'
import {
  decodeShare,
  encodeShare,
  indexAt,
  landing,
  parseEntries,
  wheelGradient,
  wheelShareUrl,
  withoutEntry,
} from '../wheel'

describe('the wheel', () => {
  it('reads one entry per line, trimmed, without empty lines', () => {
    expect(parseEntries(' a \r\n\n  \nb\n')).toEqual(['a', 'b'])
  })

  it('removes the first line that reads the entry', () => {
    expect(withoutEntry('a\n b \nb\nc', 'b')).toBe('a\nb\nc')
    expect(withoutEntry('a\nc', 'b')).toBe('a\nc')
  })

  it('names the entry under the pointer', () => {
    expect(indexAt(0, 4)).toBe(0)
    expect(indexAt(-100, 4)).toBe(1)
    expect(indexAt(90, 4)).toBe(3)
    expect(indexAt(0, 0)).toBe(-1)
  })

  it('lands on the entry it was told to, after the turns asked for', () => {
    for (const n of [1, 2, 3, 7, 80]) {
      for (let index = 0; index < n; index++) {
        for (const from of [0, 123.4, 359, 5000]) {
          const to = landing(from, index, n, 6, 0.5)
          expect(indexAt(to, n)).toBe(index)
          expect(to).toBeGreaterThanOrEqual(from + 6 * 360)
          expect(to).toBeLessThan(from + 7 * 360)
        }
      }
    }
  })

  it('never stops on a line between two entries', () => {
    for (const within of [0, 1, -3, 9]) {
      expect(indexAt(landing(0, 2, 5, 3, within), 5)).toBe(2)
    }
  })

  it('never puts one tone beside itself', () => {
    const tones = ['A', 'B', 'C']
    for (const n of [2, 3, 4, 5, 9]) {
      const used = [...wheelGradient(n, tones, 'L').matchAll(/([ABC]) [\d.]+deg/g)].map((m) => m[1])
      expect(used).toHaveLength(n)
      used.forEach((tone, i) => expect(tone).not.toBe(used[(i + 1) % n]))
    }
  })

  it('carries a list in a link and reads it back', () => {
    const list = ['Weekly bosses', '深境螺旋', 'a+b/c?', 'ë']
    expect(decodeShare(`#w=${encodeShare(list)}`)).toEqual(list)
    expect(decodeShare('')).toBeNull()
    expect(decodeShare('#w=%%%')).toBeNull()
    expect(decodeShare(`#w=${encodeShare([])}`)).toEqual([])
    expect(decodeShare('#w=e30')).toBeNull()
  })

  it('shares a link to the public wheel page on the given origin', () => {
    const list = ['Amber', 'Kaeya', 'Lisa']
    const url = wheelShareUrl('https://tracker.example', list)
    expect(url).toBe(`https://tracker.example/fun/wheel#w=${encodeShare(list)}`)
    expect(wheelShareUrl('http://localhost:5173/', list)).toBe(
      `http://localhost:5173/fun/wheel#w=${encodeShare(list)}`,
    )
    expect(decodeShare(new URL(url).hash)).toEqual(list)
  })
})
