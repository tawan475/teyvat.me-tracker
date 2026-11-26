/**
 * Who sees the "Export as…" menus and the import buttons beside them, and
 * which files the achievements import refuses before reading. Pure, so the
 * rules are tested (the pages and dialogs only call these).
 */

import { UIAF_MAX_BYTES } from '@gdt/shared/achievements/uiaf'

/**
 * The menu rows a page shows: the formats whose data exists (`available`),
 * for everyone who can view the account (owner, editor, viewer, guest, demo,
 * time travel); none in staff Inspect, which exports nothing. No rows hides
 * the button.
 */
export function exportRowsShown(
  account: { source?: 'staff' | 'demo' | 'local' },
  available: readonly string[],
): readonly string[] {
  return account.source === 'staff' ? [] : available
}

/**
 * Whether a page shows its Import button. Read-only pages (viewers, time
 * travel, staff Inspect) never import. The demo keeps achievement marks in
 * the tab, so it imports achievements, but never wishes (they would be
 * uploaded).
 */
export function importShown(
  page: 'wishes' | 'achievements',
  mode: { readOnly: boolean; demo?: boolean },
): boolean {
  if (mode.readOnly) return false
  return page === 'achievements' || mode.demo !== true
}

/** An achievements file refused unread: larger than UIAF_MAX_BYTES, whatever its format. */
export function refusedBySize(bytes: number): boolean {
  return bytes > UIAF_MAX_BYTES
}
