/**
 * The staff dashboard's endpoints (/api/staff). The Worker checks every
 * request against the caller's roles; the app only hides what they can't use.
 */

import type {
  ApiLimitsOverride,
  ApiTier,
  LiveJournalResponse,
  LivePointsResponse,
  DomainEventWindow,
  AuditKind,
  CatalogRow,
  InspectView,
  SignupMode,
  SnapshotResponse,
  StaffAuditResponse,
  StaffInspectResponse,
  StaffMeResponse,
  StaffOverviewResponse,
  StaffPurgeResponse,
  StaffResetLinkResponse,
  StaffRole,
  StaffRolesResponse,
  StaffSiteResponse,
  StaffStorageResponse,
  StaffUserDetailResponse,
  StaffUserFilter,
  StaffUserSort,
  StaffUsersResponse,
  StorageSort,
  StorageWindow,
} from '@gdt/shared'
import { request, requestJson } from './http'

/** `?a=1&b=2` from the set values (none: ''). */
function query(values: Record<string, string | number | boolean | undefined | null>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    params.set(key, value === true ? '1' : String(value))
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

const user = (id: number) => `/api/staff/users/${id}`
const account = (id: number) => `/api/staff/accounts/${id}`

export type PurgeBody =
  | { kind: 'snapshots'; ids: number[] }
  | { kind: 'range'; from: number; to: number }
  | { kind: 'trash' }

export const staffApi = {
  me: () => requestJson<StaffMeResponse>('/api/staff/me'),
  overview: () => requestJson<StaffOverviewResponse>('/api/staff/overview'),
  site: () => requestJson<StaffSiteResponse>('/api/staff/site'),
  updateSite: (patch: {
    signupMode?: SignupMode
    dailySnapshots?: number | null
    dailyBytes?: number | null
    storageQuota?: number | null
    domainEvents?: DomainEventWindow[] | null
  }) => requestJson<StaffSiteResponse>('/api/staff/site', { method: 'PATCH', json: patch }),
  syncEvents: () => requestJson<StaffSiteResponse>('/api/staff/events/sync', { method: 'POST' }),

  users: (params: {
    q?: string
    filter?: StaffUserFilter
    sort?: StaffUserSort
    dir?: 'asc' | 'desc'
    page?: number
  }) => requestJson<StaffUsersResponse>(`/api/staff/users${query(params)}`),
  user: (id: number) => requestJson<StaffUserDetailResponse>(user(id)),
  bulk: (
    body:
      | { action: 'suspend'; ids: number[]; reason: string }
      | { action: 'delete'; ids: number[]; confirm: 'DELETE' },
  ) =>
    requestJson<{ done: number; skipped: number[] }>('/api/staff/users/bulk', {
      method: 'POST',
      json: body,
    }),
  suspend: (id: number, reason: string) =>
    requestJson<void>(`${user(id)}/suspend`, { method: 'POST', json: { reason } }),
  unsuspend: (id: number) => requestJson<void>(`${user(id)}/suspend`, { method: 'DELETE' }),
  rename: (id: number, username: string) =>
    requestJson<void>(`${user(id)}/rename`, { method: 'POST', json: { username } }),
  resetLink: (id: number) =>
    requestJson<StaffResetLinkResponse>(`${user(id)}/reset-link`, { method: 'POST' }),
  signOut: (id: number) => requestJson<void>(`${user(id)}/sign-out`, { method: 'POST' }),
  signOutSession: (id: number, sessionId: number) =>
    requestJson<void>(`${user(id)}/sessions/${sessionId}`, { method: 'DELETE' }),
  unlink: (id: number, provider: string) =>
    requestJson<void>(`${user(id)}/identities/${provider}`, { method: 'DELETE' }),
  deleteUser: (id: number, username: string) =>
    requestJson<void>(user(id), { method: 'DELETE', json: { username } }),
  setUploads: (id: number, blocked: boolean, reason = '') =>
    requestJson<void>(`${user(id)}/uploads`, { method: 'POST', json: { blocked, reason } }),
  /** The user's public API limits: tier, and an override for someone who asked for more. */
  setApiLimits: (id: number, tier: ApiTier, override: ApiLimitsOverride | null) =>
    requestJson<void>(`/api/staff/users/${id}/api-limits`, {
      method: 'PUT',
      json: { tier, override },
    }),
  setQuota: (id: number, bytes: number | null) =>
    requestJson<void>(`${user(id)}/quota`, { method: 'PUT', json: { bytes } }),
  revokeUserKey: (id: number) => requestJson<void>(`${user(id)}/import-key`, { method: 'DELETE' }),
  addRole: (id: number, roleId: number) =>
    requestJson<void>(`${user(id)}/roles`, { method: 'POST', json: { roleId } }),
  removeRole: (id: number, roleId: number) =>
    requestJson<void>(`${user(id)}/roles/${roleId}`, { method: 'DELETE' }),

  resetAccountKey: (id: number) =>
    requestJson<void>(`${account(id)}/import-key`, { method: 'POST' }),
  purge: (id: number, body: PurgeBody) =>
    requestJson<StaffPurgeResponse>(`${account(id)}/purge`, { method: 'POST', json: body }),
  deleteAccount: (id: number) => requestJson<void>(account(id), { method: 'DELETE' }),
  /** Opens a page of someone's data: logged; answers the account and its owner. */
  inspect: (id: number, view: InspectView) =>
    requestJson<StaffInspectResponse>(`${account(id)}/inspect`, {
      method: 'POST',
      json: { view },
    }),
  snapshots: (id: number) => requestJson<SnapshotResponse[]>(`${account(id)}/snapshots`),
  catalog: (id: number) => requestJson<CatalogRow[]>(`${account(id)}/catalog`),
  /** The account's open live sync journal (logged like the other data looks). */
  live: (id: number) => requestJson<LiveJournalResponse>(`${account(id)}/live`),
  /** Live sync's chart points of the last 400 days (logged like the other data looks). */
  points: (id: number) => requestJson<LivePointsResponse>(`${account(id)}/points`),
  /** Always GDT2 (the app's layout). */
  bundle: async (id: number, options: { ids?: number[]; sections?: string[] } = {}) => {
    const qs = query({ ids: options.ids?.join(','), sections: options.sections?.join(',') })
    return (await request(`${account(id)}/bundle${qs}`)).arrayBuffer()
  },

  storage: (params: {
    window?: StorageWindow
    sort?: StorageSort
    flagged?: boolean
    q?: string
    page?: number
  }) => requestJson<StaffStorageResponse>(`/api/staff/storage${query(params)}`),

  roles: () => requestJson<StaffRolesResponse>('/api/staff/roles'),
  createRole: (body: { name: string; color: string; permissions: string[] }) =>
    requestJson<StaffRole>('/api/staff/roles', { method: 'POST', json: body }),
  updateRole: (id: number, body: { name?: string; color?: string; permissions?: string[] }) =>
    requestJson<StaffRole>(`/api/staff/roles/${id}`, { method: 'PATCH', json: body }),
  deleteRole: (id: number) => requestJson<void>(`/api/staff/roles/${id}`, { method: 'DELETE' }),
  orderRoles: (ids: number[]) =>
    requestJson<void>('/api/staff/roles/order', { method: 'PUT', json: { ids } }),

  audit: (params: { q?: string; actor?: number; kind?: AuditKind; user?: number; page?: number }) =>
    requestJson<StaffAuditResponse>(`/api/staff/audit${query(params)}`),
}

export type StaffApi = typeof staffApi
