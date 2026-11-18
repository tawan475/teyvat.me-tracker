/**
 * The /privacy page's table (issue 12 item 7, design A): what the site keeps,
 * for how long, who sees it and where it is deleted. Plain data, so a test can
 * hold every row's message keys and the retention figures against the code
 * that enforces them (worker/services/maintenance.ts, worker/lib/session.ts).
 * Text lives in `landing.privacyPage` (and the site's own words for page and
 * button names, so a path reads like the controls it names).
 */

export type PrivacyGroup = 'data' | 'signIn' | 'alerts' | 'browser'

/** The table's groups, in order; the filter chips follow it after "All". */
export const PRIVACY_GROUPS: readonly PrivacyGroup[] = ['data', 'signIn', 'alerts', 'browser']

/** How long a row is kept: told apart by icon and word as well as by its ground. */
export type KeepKind = 'forever' | 'auto' | 'local'

/** A note under the Kept cell: a button opening a popover with the detail. */
export type PrivacyNote = 'purged' | 'wishLink' | 'points' | 'idle' | 'revoked'

export type PrivacyRowKey =
  | 'snapshots'
  | 'wishes'
  | 'live'
  | 'planner'
  | 'account'
  | 'devices'
  | 'keys'
  | 'alerts'
  | 'local'

export interface PrivacyRow {
  key: PrivacyRowKey
  group: PrivacyGroup
  /** The row's name (a message key). */
  name: string
  /** What it holds (a message key). */
  what: string
  keep: { kind: KeepKind; label: string }
  note?: PrivacyNote
  /** Who sees it (a message key). */
  who: string
  /** Where it is deleted: one message key per step ("Settings › Delete user"). */
  path: readonly string[]
  /** A second way, on a line of its own under the path: message keys joined by a space ("or Compact history"). */
  or?: readonly string[]
}

const P = 'landing.privacyPage'

export const PRIVACY_ROWS: readonly PrivacyRow[] = [
  {
    key: 'snapshots',
    group: 'data',
    name: 'shell.page.snapshots',
    what: `${P}.what.snapshots`,
    keep: { kind: 'forever', label: `${P}.kept.forever` },
    note: 'purged',
    who: `${P}.who.shared`,
    path: ['shell.page.snapshots', 'common.delete'],
    or: ['common.or', 'snapshots.compact.title'],
  },
  {
    key: 'wishes',
    group: 'data',
    name: 'shell.page.wishHistory',
    what: `${P}.what.wishes`,
    keep: { kind: 'forever', label: `${P}.kept.forever` },
    note: 'wishLink',
    who: `${P}.who.shared`,
    path: ['shell.page.wishHistory', 'common.delete'],
  },
  {
    key: 'live',
    group: 'data',
    name: 'staff.split.live',
    what: `${P}.what.live`,
    keep: { kind: 'auto', label: `${P}.kept.nextSnapshot` },
    note: 'points',
    who: `${P}.who.shared`,
    path: ['shell.page.snapshots', 'live.row', 'live.discard'],
  },
  {
    key: 'planner',
    group: 'data',
    name: `${P}.names.planner`,
    what: `${P}.what.planner`,
    keep: { kind: 'forever', label: `${P}.kept.forever` },
    who: `${P}.who.shared`,
    path: [`${P}.paths.editInPlace`],
    or: [`${P}.paths.orDeleteAccount`],
  },
  {
    key: 'account',
    group: 'signIn',
    name: `${P}.names.account`,
    what: `${P}.what.account`,
    keep: { kind: 'forever', label: `${P}.kept.forever` },
    who: `${P}.who.you`,
    path: ['shell.page.settings', 'settings.deleteUser.title'],
  },
  {
    key: 'devices',
    group: 'signIn',
    name: `${P}.names.devices`,
    what: `${P}.what.devices`,
    keep: { kind: 'auto', label: `${P}.kept.afterSignOut` },
    note: 'idle',
    who: `${P}.who.you`,
    path: ['shell.page.settings', 'shell.page.devices', 'common.signOut'],
  },
  {
    key: 'keys',
    group: 'signIn',
    name: `${P}.names.keys`,
    what: `${P}.what.keys`,
    keep: { kind: 'forever', label: `${P}.kept.forever` },
    note: 'revoked',
    who: `${P}.who.youOnce`,
    path: ['shell.page.settings', 'settings.apiTokens.title'],
  },
  {
    key: 'alerts',
    group: 'alerts',
    name: 'settings.devices.alerts.label',
    what: `${P}.what.alerts`,
    keep: { kind: 'auto', label: `${P}.kept.alertsOff` },
    who: `${P}.who.you`,
    path: ['shell.page.settings', 'shell.page.devices', `${P}.paths.alertsOff`],
  },
  {
    key: 'local',
    group: 'browser',
    name: `${P}.names.local`,
    what: `${P}.what.local`,
    keep: { kind: 'local', label: `${P}.kept.local` },
    who: `${P}.who.browser`,
    path: [`${P}.paths.browser`, `${P}.paths.clearSiteData`],
  },
]

/** Each group's heading (a message key): the alerts group uses the site's own word. */
export const GROUP_LABEL: Record<PrivacyGroup, string> = {
  data: `${P}.groups.data`,
  signIn: `${P}.groups.signIn`,
  alerts: 'settings.devices.alerts.label',
  browser: `${P}.groups.browser`,
}

/** Each note: its button, the popover's title and its text. */
export const NOTE_TEXT: Record<PrivacyNote, { label: string; title: string; body: string }> = {
  purged: {
    label: `${P}.notes.purged.label`,
    title: `${P}.notes.purged.title`,
    body: `${P}.notes.purged.body`,
  },
  wishLink: {
    label: `${P}.notes.wishLink.label`,
    title: `${P}.notes.wishLink.title`,
    body: `${P}.notes.wishLink.body`,
  },
  points: {
    label: `${P}.notes.points.label`,
    title: `${P}.notes.points.title`,
    body: `${P}.notes.points.body`,
  },
  idle: {
    label: `${P}.notes.idle.label`,
    title: `${P}.names.devices`,
    body: `${P}.notes.idle.body`,
  },
  revoked: {
    label: `${P}.notes.revoked.label`,
    title: 'settings.apiTokens.title',
    body: `${P}.notes.revoked.body`,
  },
}

/** The rows a filter shows, grouped, each group led by its heading row. */
export function visibleGroups(
  filter: PrivacyGroup | 'all',
): { group: PrivacyGroup; rows: PrivacyRow[] }[] {
  return PRIVACY_GROUPS.filter((group) => filter === 'all' || filter === group).map((group) => ({
    group,
    rows: PRIVACY_ROWS.filter((row) => row.group === group),
  }))
}

/** How many rows each chip counts. */
export function groupCount(filter: PrivacyGroup | 'all'): number {
  return visibleGroups(filter).reduce((n, g) => n + g.rows.length, 0)
}
