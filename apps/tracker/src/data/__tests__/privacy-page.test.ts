import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en'
import view from '@/views/PrivacyView.vue?raw'
import maintenance from '../../../worker/services/maintenance.ts?raw'
import { SESSION_KEEP_DAYS, TRASH_DAYS } from '../../../worker/services/maintenance'
import { REFRESH_TTL_S } from '../../../worker/lib/session'
import {
  GROUP_LABEL,
  groupCount,
  NOTE_TEXT,
  PRIVACY_GROUPS,
  PRIVACY_ROWS,
  visibleGroups,
} from '../privacy-page'

/** Every English message as `namespace.path` -> text. */
function flatten(value: unknown, prefix = '', out = new Map<string, string>()) {
  if (typeof value === 'string') out.set(prefix, value)
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out)
    }
  }
  return out
}
const messages = flatten(en)
const text = (key: string) => {
  const value = messages.get(key)
  expect(value, key).toBeTypeOf('string')
  return value!
}

describe('the privacy table', () => {
  it('names only messages that exist', () => {
    const keys = [
      ...PRIVACY_ROWS.flatMap((row) => [
        row.name,
        row.what,
        row.keep.label,
        row.who,
        ...row.path,
        ...(row.or ?? []),
      ]),
      ...Object.values(GROUP_LABEL),
      ...Object.values(NOTE_TEXT).flatMap((note) => [note.label, note.title, note.body]),
    ]
    for (const key of keys) text(key)
  })

  it('names only messages that exist in the page itself', () => {
    const literal = [
      ...view.matchAll(/\$t\('([\w.]+)'\)/g),
      ...view.matchAll(/\bt\('([\w.]+)'\)/g),
      ...view.matchAll(/keypath="([\w.]+)"/g),
    ].map((m) => m[1]!)
    expect(literal.length).toBeGreaterThan(10)
    for (const key of literal) text(key)
  })

  it('has the rows the design shows, in its groups', () => {
    expect(PRIVACY_ROWS).toHaveLength(9)
    expect(groupCount('all')).toBe(9)
    expect(PRIVACY_GROUPS.map((group) => groupCount(group))).toEqual([4, 3, 1, 1])
    expect(new Set(PRIVACY_ROWS.map((row) => row.key)).size).toBe(PRIVACY_ROWS.length)
  })

  it('keeps the chosen group (and its heading) alone under a filter', () => {
    expect(visibleGroups('signIn')).toEqual([
      { group: 'signIn', rows: PRIVACY_ROWS.filter((row) => row.group === 'signIn') },
    ])
    expect(visibleGroups('all').map((g) => g.group)).toEqual([...PRIVACY_GROUPS])
  })
})

describe('the privacy page says what the code does', () => {
  const P = 'landing.privacyPage'
  const days = (n: number) => `${n} days`

  it('deleted snapshots: purged after TRASH_DAYS', () => {
    expect(text(`${P}.notes.purged.label`)).toContain(days(TRASH_DAYS))
    expect(text(`${P}.notes.purged.days`)).toBe(days(TRASH_DAYS))
  })

  it('devices: signed out after the refresh lifetime, rows gone SESSION_KEEP_DAYS later', () => {
    const idle = REFRESH_TTL_S / 86_400
    expect(text(`${P}.kept.afterSignOut`)).toContain(days(SESSION_KEEP_DAYS))
    expect(text(`${P}.notes.idle.label`)).toContain(days(idle))
    expect(text(`${P}.notes.idle.body`)).toContain(days(idle))
    expect(text(`${P}.notes.idle.body`)).toContain(days(SESSION_KEEP_DAYS))
  })

  it('API tokens: removed as long after revoking as maintenance waits', () => {
    const match = /API tokens[^\n]*\n[\s\S]*?\.bind\(now - (\d+) \* 86_400_000\)/.exec(maintenance)
    const kept = Number(match?.[1])
    expect(kept).toBeGreaterThan(0)
    expect(text(`${P}.notes.revoked.label`)).toContain(days(kept))
    expect(text(`${P}.notes.revoked.body`)).toContain(days(kept))
  })
})
