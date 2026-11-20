/**
 * Staff permission nodes and site switches without any request schema (no
 * zod): what the app needs at startup to show or hide staff pages. Re-exported
 * by ./staff.
 */

/** Every permission node, in the order the Roles page lists them. Managing and deleting are always separate. */
export const PERMISSION_NODES = [
  'staff.view',
  'users.view',
  'users.view_private',
  'users.reset_password',
  'users.sessions',
  'users.manage',
  'users.identities',
  'users.delete',
  'data.storage',
  'data.inspect',
  'data.manage',
  'data.delete',
  'site.settings',
  'roles.manage',
  'audit.view',
  // Appended 2026-11-20: the Metrics page.
  'site.metrics',
] as const
export type PermissionNode = (typeof PERMISSION_NODES)[number]

/** The Owner role's only node: every permission, now and later. */
export const ALL_PERMISSIONS = '*'

/** The nodes grouped as the Roles page shows them, with their labels. */
export const PERMISSION_GROUPS: {
  name: string
  nodes: { node: PermissionNode; label: string }[]
}[] = [
  { name: 'Staff', nodes: [{ node: 'staff.view', label: 'Open the dashboard' }] },
  {
    name: 'Users',
    nodes: [
      { node: 'users.view', label: 'See users' },
      { node: 'users.view_private', label: 'Email, IPs and sessions' },
      { node: 'users.reset_password', label: 'Make reset links' },
      { node: 'users.sessions', label: 'Sign out sessions' },
      { node: 'users.manage', label: 'Rename and suspend' },
      { node: 'users.identities', label: 'Unlink Discord and Google' },
      { node: 'users.delete', label: 'Delete users' },
    ],
  },
  {
    name: 'Data',
    nodes: [
      { node: 'data.storage', label: 'Storage page' },
      { node: 'data.inspect', label: 'View game data' },
      { node: 'data.manage', label: 'Block uploads, quotas, reset keys' },
      { node: 'data.delete', label: 'Delete data' },
    ],
  },
  {
    name: 'Site',
    nodes: [
      { node: 'site.settings', label: 'Sign-up switch and upload limits' },
      { node: 'site.metrics', label: 'Metrics page' },
      { node: 'roles.manage', label: 'Edit and assign lower roles' },
      { node: 'audit.view', label: 'Read the audit log' },
    ],
  },
]

/** Whether a set of nodes (a user's, from MeResponse.permissions) includes `node`. */
export function hasPermission(nodes: readonly string[], node: PermissionNode): boolean {
  return nodes.includes(ALL_PERMISSIONS) || nodes.includes(node)
}

/** The colours a role can take (the Roles page's swatches). */
export const ROLE_COLORS = [
  '#f59e0b',
  '#8b5cf6',
  '#0ea5e9',
  '#10b981',
  '#ec4899',
  '#64748b',
] as const

/**
 * Who may create an account: anyone (`open`), only through Discord or
 * Google (`oauth`), or nobody (`closed`). Existing users always sign in.
 */
export const SIGNUP_MODES = ['open', 'oauth', 'closed'] as const
export type SignupMode = (typeof SIGNUP_MODES)[number]

/** Staff users list: page size and how many a bulk action takes. */
export const STAFF_PAGE_SIZE = 50
export const STAFF_BULK_MAX = 100
