import type { StaffUserRow } from '@gdt/shared'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'

const WEEK = 7 * 86_400_000

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning'

/** A user's one status badge: suspended, uploads blocked, or new (joined this week). */
export function userStatus(
  user: Pick<StaffUserRow, 'suspendedAt' | 'uploadsBlockedAt' | 'createdAt'>,
  now = Date.now(),
): { label: string; tone: BadgeTone } | null {
  if (user.suspendedAt !== null) return { label: t('staff.status.suspended'), tone: 'danger' }
  if (user.uploadsBlockedAt !== null)
    return { label: t('staff.status.uploadsBlocked'), tone: 'warning' }
  if (now - user.createdAt < WEEK) return { label: t('staff.status.new'), tone: 'accent' }
  return null
}

/** How an audit action reads in a sentence ("suspended", "inspected Main · Artifacts"). */
export function auditPhrase(action: string, detail: Record<string, unknown>): string {
  const text = (key: string) => (typeof detail[key] === 'string' ? (detail[key] as string) : '')
  switch (action) {
    case 'user.suspend':
      return t('staff.history.suspend')
    case 'user.unsuspend':
      return t('staff.history.unsuspend')
    case 'user.rename':
      return t('staff.history.rename', { from: text('from'), to: text('to') })
    case 'user.reset_link':
      return t('staff.history.resetLink')
    case 'user.sessions':
      return detail.all ? t('staff.history.sessionsAll') : t('staff.history.sessionsOne')
    case 'user.unlink':
      return t('staff.history.unlink', { provider: text('provider') })
    case 'user.delete':
      return t('staff.history.deleteUser')
    case 'user.delete_self':
      return t('staff.history.deleteSelf')
    case 'role.assign':
      return t('staff.history.roleAssign', { role: text('role') })
    case 'role.unassign':
      return t('staff.history.roleUnassign', { role: text('role') })
    case 'data.inspect':
      return t('staff.history.inspect', {
        what: [text('account'), text('view')].filter(Boolean).join(' · '),
      })
    case 'data.block_uploads':
      return t('staff.history.blockUploads')
    case 'data.unblock_uploads':
      return t('staff.history.unblockUploads')
    case 'data.api_limits':
      return t('staff.history.apiLimits', { tier: text('tier') })
    case 'data.quota':
      return detail.bytes === null ? t('staff.history.quotaReset') : t('staff.history.quotaSet')
    case 'data.reset_key':
      return text('account')
        ? t('staff.history.resetKey', { account: text('account') })
        : t('staff.history.revokeUserKey')
    case 'data.delete':
      return t('staff.history.deleteData', {
        n: typeof detail.snapshots === 'number' ? formatNumber(detail.snapshots) : '',
        account: text('account'),
      })
    case 'data.delete_account':
      return t('staff.history.deleteAccount', { account: text('account') })
    default:
      return action
  }
}
