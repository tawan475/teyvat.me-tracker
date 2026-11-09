import { describe, expect, it } from 'vitest'
import { formatJson } from '../raw-export/inflate'

// The raw download's JSON (src/data/raw-export/inflate.ts): indented, but
// what fits in 100 characters stays on one line, spaced like Prettier.

describe('raw download JSON', () => {
  const value = {
    characters: [
      [1, 90, 6, 6, 6, 7, 6],
      [4, 90, 6, 0, 9, 9, 9],
    ],
    name: 'x'.repeat(120),
    empty: [],
    none: {},
    nothing: null,
    gone: undefined,
    list: Array.from({ length: 40 }, (_, i) => i * 1000),
  }

  it('parses back to the same value', () => {
    expect(JSON.parse(formatJson(value))).toEqual(JSON.parse(JSON.stringify(value)))
  })

  it('keeps what fits on one line and breaks the rest', () => {
    const lines = formatJson(value).split('\n')
    expect(lines).toContain('  "characters": [[1, 90, 6, 6, 6, 7, 6], [4, 90, 6, 0, 9, 9, 9]],')
    expect(lines).toContain('  "empty": [],')
    expect(lines).toContain('  "none": {},')
    expect(lines.some((l) => l.includes('"gone"'))).toBe(false)
    // 40 numbers do not fit in 100 characters: one per line.
    expect(lines.filter((l) => /^ {4}\d+,?$/.test(l))).toHaveLength(40)
    expect(lines[0]).toBe('{')
    expect(lines.at(-1)).toBe('}')
    // Only a string too long for any line passes the width.
    for (const line of lines)
      if (!line.includes('xxx')) expect(line.length).toBeLessThanOrEqual(100)
  })

  it('writes a small value on one line', () => {
    expect(formatJson({ a: [1, 2], b: 'c' })).toBe('{"a": [1, 2], "b": "c"}')
    expect(formatJson([])).toBe('[]')
  })
})
