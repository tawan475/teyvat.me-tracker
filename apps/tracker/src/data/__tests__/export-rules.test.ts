import { describe, expect, it } from 'vitest'
import { UIAF_MAX_BYTES } from '@gdt/shared/achievements/uiaf'
import { exportRowsShown, importShown, refusedBySize } from '../export-rules'

describe('exportRowsShown', () => {
  const rows = ['uiaf', 'leyline']
  it('lists the available rows for every viewer of the account', () => {
    expect(exportRowsShown({}, rows)).toEqual(rows)
    expect(exportRowsShown({ source: 'demo' }, rows)).toEqual(rows)
    expect(exportRowsShown({ source: 'local' }, rows)).toEqual(rows)
  })
  it('shows nothing in staff Inspect', () => {
    expect(exportRowsShown({ source: 'staff' }, rows)).toEqual([])
  })
})

describe('importShown', () => {
  it('hides Import on read-only pages (viewers, time travel, Inspect)', () => {
    expect(importShown('achievements', { readOnly: true })).toBe(false)
    expect(importShown('wishes', { readOnly: true })).toBe(false)
    expect(importShown('achievements', { readOnly: true, demo: true })).toBe(false)
  })
  it('shows it to the owner, editors and the guest', () => {
    expect(importShown('achievements', { readOnly: false })).toBe(true)
    expect(importShown('wishes', { readOnly: false })).toBe(true)
  })
  it('the demo imports achievements (kept in the tab), never wishes', () => {
    expect(importShown('achievements', { readOnly: false, demo: true })).toBe(true)
    expect(importShown('wishes', { readOnly: false, demo: true })).toBe(false)
  })
})

describe('refusedBySize', () => {
  it('refuses any file over 5 MB before it is read', () => {
    expect(UIAF_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(refusedBySize(UIAF_MAX_BYTES)).toBe(false)
    expect(refusedBySize(UIAF_MAX_BYTES + 1)).toBe(true)
    expect(refusedBySize(0)).toBe(false)
  })
})
