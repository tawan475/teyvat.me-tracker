import { describe, expect, it } from 'vitest'
import {
  CLOSING_TONE,
  decodeShare,
  encodeShare,
  faceTurn,
  indexAt,
  indexOnScreen,
  labelAngle,
  landing,
  parseEntries,
  POINTER_ANGLE,
  sliceTone,
  WHEEL_TONES,
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

  it('announces the entry the drawn pointer shows, its label level and reading outwards', () => {
    expect(POINTER_ANGLE).toBe(90)
    for (const n of [1, 2, 3, 6, 7, 40]) {
      for (let index = 0; index < n; index++) {
        for (const from of [0, 77.7, 3600]) {
          const to = landing(from, index, n, 5, 0.5)
          // What the face drawn at faceTurn(to) shows under the pointer at the right.
          expect(indexOnScreen(faceTurn(to), n)).toBe(index)
          expect(indexAt(to, n)).toBe(index)
          // The label's line on screen points right (0deg), so it reads left to right.
          const screen = (((labelAngle(index, n) + faceTurn(to)) % 360) + 360) % 360
          expect(Math.min(screen, 360 - screen)).toBeLessThan(1e-6)
        }
      }
    }
  })

  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const c = parseInt(hex.slice(at, at + 2), 16) / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (hi! + 0.05) / (lo! + 0.05)
  }

  it('gives every label ink 4.5:1 on its slice', () => {
    for (const tone of [...WHEEL_TONES, CLOSING_TONE]) {
      expect(contrast(tone.fill, tone.ink)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('never puts two slices of like lightness side by side, even where the wheel closes', () => {
    for (let n = 2; n <= 41; n++) {
      for (let i = 0; i < n; i++) {
        const here = sliceTone(i, n).fill
        const next = sliceTone((i + 1) % n, n).fill
        expect(here).not.toBe(next)
        expect(contrast(here, next), `${n} slices, ${i} beside ${(i + 1) % n}`).toBeGreaterThan(1.5)
      }
    }
    expect(wheelGradient(1, 'L')).toBe(sliceTone(0, 1).fill)
    expect([...wheelGradient(5, 'L').matchAll(/#[0-9a-f]{6} [\d.]+deg/g)]).toHaveLength(5)
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
