<script setup lang="ts">
import {
  OAUTH_PROVIDERS,
  type ApiLimitsOverride,
  type ApiTier,
  type StaffAccountRow,
  type StaffUserDetailResponse,
} from '@gdt/shared'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowLeft,
  Ban,
  Eye,
  Link2,
  LogOut,
  Monitor,
  Pencil,
  Plus,
  Smartphone,
  Trash2,
  Unlink,
  X,
} from 'lucide-vue-next'
import ProviderMark from '@/components/oauth/ProviderMark.vue'
import { providerLabel } from '@/components/oauth/oauth'
import ActionMenu, { type MenuItem } from '@/components/staff/ActionMenu.vue'
import DeleteDataDialog from '@/components/staff/DeleteDataDialog.vue'
import DeleteUserDialog from '@/components/staff/DeleteUserDialog.vue'
import ApiLimitsDialog from '@/components/staff/ApiLimitsDialog.vue'
import QuotaDialog from '@/components/staff/QuotaDialog.vue'
import ReasonDialog from '@/components/staff/ReasonDialog.vue'
import RenameDialog from '@/components/staff/RenameDialog.vue'
import ResetLinkDialog from '@/components/staff/ResetLinkDialog.vue'
import RoleBadge from '@/components/staff/RoleBadge.vue'
import StorageSplitBar from '@/components/staff/StorageSplitBar.vue'
import { deviceName, onPhone } from '@/components/settings/devices'
import { auditPhrase, userStatus } from '@/components/staff/status'
import { serverName } from '@/components/user/servers'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiError from '@/components/ui/UiError.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiPopover from '@/components/ui/UiPopover.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiStat from '@/components/ui/UiStat.vue'
import { ApiRequestError, api, type PurgeBody } from '@/api'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { formatBytes, formatDate, formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'
import { useStaff } from '@/stores/staff'

/**
 * One user, for staff: who they are and how they sign in, their Genshin
 * accounts (Inspect, keys, quota, deleting data), their sessions, and what
 * staff did to them. Actions show only for the caller's nodes, and only on
 * users below the caller's highest role.
 */
const route = useRoute()
const router = useRouter()
const session = useSession()
const feedback = useFeedback()
const staffStore = useStaff()

const userId = computed(() => Number(route.params.userId))
const { data, error, reload } = useResource(
  () => userId.value,
  (id) => api.staff.user(id),
)
const detail = computed<StaffUserDetailResponse | undefined>(() =>
  data.value?.user.id === userId.value ? data.value : undefined,
)
const user = computed(() => detail.value?.user)
/** The user as dialogs name them. */
const target = computed(() =>
  user.value ? { id: user.value.id, username: user.value.username } : null,
)
const status = computed(() => (user.value ? userStatus(user.value) : null))

/** A node the caller holds, on a user they outrank. */
const may = (node: Parameters<typeof session.can>[0]) =>
  session.can(node) && detail.value?.outranked === true

const busy = ref(false)

/** Runs an action, says how it went, and reloads the page's data. */
async function act(work: () => Promise<unknown>, done: string, failed: string): Promise<boolean> {
  busy.value = true
  try {
    await work()
    feedback.toast({ tone: 'success', title: done })
    await reload()
    return true
  } catch (cause) {
    feedback.error(failed, cause)
    return false
  } finally {
    busy.value = false
  }
}

// --------------------------------------------------------------------- dialogs

const resetOpen = ref(false)
const suspendOpen = ref(false)
const blockOpen = ref(false)
const renameOpen = ref(false)
const renameError = ref('')
const deleteOpen = ref(false)
const quotaOpen = ref(false)
const apiLimitsOpen = ref(false)
const dataAccount = ref<StaffAccountRow | null>(null)

async function suspend(reason: string) {
  if (
    await act(
      () => api.staff.suspend(userId.value, reason),
      t('staff.common.suspended'),
      t('staff.common.notSuspended'),
    )
  ) {
    suspendOpen.value = false
  }
}

async function unsuspend() {
  await act(
    () => api.staff.unsuspend(userId.value),
    t('staff.user.suspensionLifted'),
    t('staff.common.notChanged'),
  )
}

async function rename(username: string) {
  renameError.value = ''
  busy.value = true
  try {
    await api.staff.rename(userId.value, username)
    renameOpen.value = false
    feedback.toast({ tone: 'success', title: t('staff.user.renamed', { name: username }) })
    await reload()
  } catch (cause) {
    if (cause instanceof ApiRequestError && cause.code === 'username_taken') {
      renameError.value = t('staff.user.taken')
    } else feedback.error(t('staff.user.notRenamed'), cause)
  } finally {
    busy.value = false
  }
}

async function remove(username: string) {
  busy.value = true
  try {
    await api.staff.deleteUser(userId.value, username)
    feedback.toast({ tone: 'success', title: t('staff.user.deleted', { name: username }) })
    deleteOpen.value = false
    await router.replace({ name: 'staff-users' })
  } catch (cause) {
    feedback.error(t('staff.common.notDeleted'), cause)
  } finally {
    busy.value = false
  }
}

async function signOutAll() {
  await act(
    () => api.staff.signOut(userId.value),
    t('staff.user.signedOutEverywhere'),
    t('staff.user.notSignedOut'),
  )
}

async function signOutSession(id: number) {
  await act(
    () => api.staff.signOutSession(userId.value, id),
    t('staff.user.signedOut'),
    t('staff.user.notSignedOut'),
  )
}

async function setUploads(blocked: boolean, reason = '') {
  if (
    await act(
      () => api.staff.setUploads(userId.value, blocked, reason),
      blocked ? t('staff.common.uploadsBlocked') : t('staff.common.uploadsUnblocked'),
      t('staff.common.notChanged'),
    )
  ) {
    blockOpen.value = false
  }
}

async function setQuota(bytes: number | null) {
  if (
    await act(
      () => api.staff.setQuota(userId.value, bytes),
      t('staff.common.quotaSaved'),
      t('staff.common.notSaved'),
    )
  ) {
    quotaOpen.value = false
  }
}

async function setApiLimits(tier: ApiTier, override: ApiLimitsOverride | null) {
  if (
    await act(
      () => api.staff.setApiLimits(userId.value, tier, override),
      t('staff.apiLimits.saved'),
      t('staff.common.notSaved'),
    )
  ) {
    apiLimitsOpen.value = false
  }
}

async function unlink(provider: string) {
  const ok = await feedback.confirm({
    title: t('staff.user.unlinkTitle', { provider: providerLabel(provider as never) }),
    detail: t('staff.user.unlinkDetail', { user: user.value?.username ?? '' }),
    confirmLabel: t('staff.user.unlink'),
    tone: 'danger',
  })
  if (ok) {
    await act(
      () => api.staff.unlink(userId.value, provider),
      t('staff.user.unlinked'),
      t('staff.user.notUnlinked'),
    )
  }
}

async function revokeUserKey() {
  const ok = await feedback.confirm({
    title: t('staff.user.revokeTitle'),
    detail: t('staff.user.revokeDetail'),
    confirmLabel: t('staff.user.revoke'),
    tone: 'danger',
  })
  if (ok) {
    await act(
      () => api.staff.revokeUserKey(userId.value),
      t('staff.user.keyRevoked'),
      t('staff.user.notRevoked'),
    )
  }
}

async function resetAccountKey(account: StaffAccountRow) {
  const ok = await feedback.confirm({
    title: t('staff.user.resetKeyTitle'),
    detail: t('staff.user.resetKeyDetail', { account: account.name || `UID ${account.uid}` }),
    confirmLabel: t('staff.user.resetKey'),
    tone: 'danger',
  })
  if (ok) {
    await act(
      () => api.staff.resetAccountKey(account.id),
      t('staff.user.keyReset'),
      t('staff.user.notReset'),
    )
  }
}

async function purge(body: PurgeBody) {
  const account = dataAccount.value
  if (!account) return
  busy.value = true
  try {
    const { deleted } = await api.staff.purge(account.id, body)
    feedback.toast({
      tone: 'success',
      title: t('staff.user.deletedSnapshots', { n: formatNumber(deleted) }, deleted),
    })
    dataAccount.value = null
    await reload()
  } catch (cause) {
    feedback.error(t('staff.common.notDeleted'), cause)
  } finally {
    busy.value = false
  }
}

async function deleteAccount() {
  const account = dataAccount.value
  if (!account) return
  if (
    await act(
      () => api.staff.deleteAccount(account.id),
      t('staff.user.accountDeleted'),
      t('staff.common.notDeleted'),
    )
  ) {
    dataAccount.value = null
  }
}

// ----------------------------------------------------------------------- roles

const roleAnchor = ref<HTMLElement | null>(null)
const roleOpen = ref(false)
const addable = computed(() => {
  const held = new Set(user.value?.roles.map((r) => r.id) ?? [])
  return (detail.value?.assignable ?? []).filter((r) => !held.has(r.id))
})
const removable = (roleId: number) => detail.value?.assignable.some((r) => r.id === roleId) ?? false

async function addRole(roleId: number) {
  roleOpen.value = false
  await act(
    () => api.staff.addRole(userId.value, roleId),
    t('staff.user.roleGiven'),
    t('staff.user.notGiven'),
  )
}

async function removeRole(roleId: number) {
  await act(
    () => api.staff.removeRole(userId.value, roleId),
    t('staff.user.roleTaken'),
    t('staff.common.notChanged'),
  )
  // The caller may have changed their own standing (never: they can't act on themselves).
  void staffStore.reload()
}

// -------------------------------------------------------------------- accounts

const showAll = ref(false)
const catalogCount = computed(() =>
  (detail.value?.accounts ?? []).reduce((sum, a) => sum + a.catalogCount, 0),
)
const ACCOUNTS_SHOWN = 4
const accounts = computed(() => {
  const list = detail.value?.accounts ?? []
  return showAll.value ? list : list.slice(0, ACCOUNTS_SHOWN)
})

function accountMenu(account: StaffAccountRow): MenuItem[] {
  const items: MenuItem[] = []
  if (may('data.manage')) {
    items.push(
      user.value?.uploadsBlockedAt
        ? { label: t('staff.user.unblockUploads'), run: () => void setUploads(false) }
        : { label: t('staff.user.blockUploadsMenu'), run: () => (blockOpen.value = true) },
      { label: t('staff.common.storageQuotaMenu'), run: () => (quotaOpen.value = true) },
      { label: t('staff.user.resetImportKey'), run: () => void resetAccountKey(account) },
    )
  }
  if (may('data.delete')) {
    items.push({
      label: t('staff.user.deleteDataMenu'),
      danger: true,
      run: () => (dataAccount.value = account),
    })
  }
  return items
}

// ------------------------------------------------------------------------ usage

const usage = computed(() => detail.value?.usage ?? null)
const quotaShare = computed(() =>
  usage.value ? Math.min(1, usage.value.storedBytes / Math.max(1, usage.value.storageQuota)) : 0,
)
/** Stored bytes per wish pull, one decimal ("2.1"). */
const perPull = (x: { wishBytes: number; wishPulls: number }) =>
  x.wishPulls ? (x.wishBytes / x.wishPulls).toFixed(1) : '—'
/** A wish history and not one snapshot: the account list alone would show nothing stored. */
const wishesOnly = computed(
  () => !!user.value && user.value.snapshots === 0 && user.value.wishPulls > 0,
)

const capHit = computed(
  () =>
    !!usage.value &&
    (usage.value.daySnapshots >= usage.value.dailySnapshots ||
      usage.value.dayBytes >= usage.value.dailyBytes),
)

/** How a session signed in (the capture apps, stored as `irminsul`, and the providers are names). */
const methodLabel = (method: string): string =>
  method === 'password' || method === 'reset' || method === 'legacy'
    ? t(`staff.methods.${method}`)
    : method === 'discord'
      ? 'Discord'
      : method === 'google'
        ? 'Google'
        : method === 'irminsul'
          ? 'Teyvat.me'
          : method

const identities = computed(() =>
  OAUTH_PROVIDERS.map((provider) => ({
    provider,
    identity: detail.value?.identities?.find((i) => i.provider === provider) ?? null,
  })),
)
</script>

<template>
  <PageHeader :title="user?.username ?? $t('staff.user.title')" />

  <RouterLink
    :to="{ name: 'staff-users' }"
    class="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-accent-text hover:underline"
  >
    <ArrowLeft class="size-4" aria-hidden="true" />
    {{ $t('staff.user.back') }}
  </RouterLink>

  <UiError
    v-if="error && !detail"
    :error="error"
    :title="$t('staff.user.couldNotLoad')"
    @retry="reload"
  />

  <div v-else-if="!detail || !user" class="flex flex-col gap-6" aria-busy="true">
    <UiSkeleton class="h-16 w-80" />
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <UiSkeleton v-for="n in 4" :key="n" class="h-20" />
    </div>
    <UiSkeleton class="h-64" />
  </div>

  <div v-else class="flex flex-col gap-6">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div class="flex min-w-0 flex-[1_1_12rem] flex-col gap-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="tabular font-mono text-xl text-text-muted">#{{ user.id }}</span>
          <h2 class="truncate text-2xl font-semibold">{{ user.username }}</h2>
          <UiBadge v-if="status" :tone="status.tone">{{ status.label }}</UiBadge>
          <UiBadge
            v-if="wishesOnly"
            tone="warning"
            :title="$t('staff.users.chips.wishesOnlyTitle')"
            >{{ $t('staff.status.wishesOnly') }}</UiBadge
          >
        </div>
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span class="text-text-muted">{{ $t('staff.common.roles') }}</span>
          <span v-if="user.roles.length === 0" class="text-text-muted">—</span>
          <RoleBadge v-for="role in user.roles" :key="role.id" :role="role">
            <button
              v-if="removable(role.id)"
              type="button"
              class="-mr-1 rounded hover:text-danger-text"
              :aria-label="$t('staff.user.takeAway', { role: role.name })"
              :title="$t('staff.user.takeAway', { role: role.name })"
              :disabled="busy"
              @click="removeRole(role.id)"
            >
              <X class="size-3.5" aria-hidden="true" />
            </button>
          </RoleBadge>
          <span v-if="addable.length" ref="roleAnchor" class="inline-flex">
            <UiButton variant="ghost" size="sm" class="min-h-7 px-2" @click="roleOpen = !roleOpen">
              <Plus class="size-4" aria-hidden="true" />
              {{ $t('staff.user.addRole') }}
            </UiButton>
            <UiPopover
              :open="roleOpen"
              :anchor="roleAnchor"
              :label="$t('staff.user.giveRole')"
              :focus="false"
              @close="roleOpen = false"
            >
              <div class="flex flex-col p-1.5">
                <button
                  v-for="role in addable"
                  :key="role.id"
                  type="button"
                  class="flex items-center gap-2.5 rounded-md px-3 py-2.5 text-left font-medium text-text-secondary hover:bg-surface-overlay hover:text-text-primary"
                  @click="addRole(role.id)"
                >
                  <span class="size-2.5 rounded-full" :style="{ backgroundColor: role.color }" />
                  {{ role.name }}
                </button>
              </div>
            </UiPopover>
          </span>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        <UiButton v-if="may('users.reset_password')" @click="resetOpen = true">
          <Link2 class="size-4" aria-hidden="true" />
          {{ $t('staff.user.resetLink') }}
        </UiButton>
        <UiButton v-if="may('users.sessions')" :disabled="busy" @click="signOutAll">
          <LogOut class="size-4" aria-hidden="true" />
          {{ $t('staff.user.signOutAll') }}
        </UiButton>
        <template v-if="may('users.manage')">
          <UiButton :disabled="busy" @click="renameOpen = true">
            <Pencil class="size-4" aria-hidden="true" />
            {{ $t('staff.user.rename') }}
          </UiButton>
          <UiButton v-if="user.suspendedAt" :disabled="busy" @click="unsuspend">
            <Ban class="size-4" aria-hidden="true" />
            {{ $t('staff.user.unsuspend') }}
          </UiButton>
          <UiButton v-else :disabled="busy" @click="suspendOpen = true">
            <Ban class="size-4" aria-hidden="true" />
            {{ $t('staff.common.suspend') }}
          </UiButton>
        </template>
        <UiButton v-if="may('users.delete')" variant="danger" @click="deleteOpen = true">
          <Trash2 class="size-4" aria-hidden="true" />
          {{ $t('staff.user.deleteUser') }}
        </UiButton>
      </div>
    </div>

    <p
      v-if="user.suspendedAt"
      class="rounded-xl border border-danger-border bg-danger-surface px-4 py-3 text-sm text-danger-text"
      role="note"
    >
      {{ $t('staff.user.suspendedNote', { when: formatRelative(user.suspendedAt) })
      }}<template v-if="user.suspendedReason"> · “{{ user.suspendedReason }}”</template>
    </p>

    <div class="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
      <UiStat
        :label="$t('staff.common.joined')"
        :value="formatDate(user.createdAt)"
        :hint="formatDateTime(user.createdAt)"
      >
        <span v-if="user.signupIp || user.signupCountry" class="text-sm text-text-muted">
          <span v-if="user.signupIp" class="font-code text-[0.8125rem]">{{ user.signupIp }}</span>
          {{ user.signupIp && user.signupCountry ? '·' : '' }} {{ user.signupCountry }}
        </span>
      </UiStat>
      <UiStat
        :label="$t('staff.common.lastActive')"
        :value="user.lastActiveAt ? formatRelative(user.lastActiveAt) : '—'"
        :hint="user.lastActiveAt ? formatDateTime(user.lastActiveAt) : undefined"
      />
      <UiStat
        :label="$t('staff.common.storage')"
        :value="usage ? formatBytes(usage.storedBytes) : formatBytes(user.storedBytes)"
      >
        <template v-if="usage">
          <span class="text-sm text-text-muted"
            >{{ $t('staff.user.ofQuota', { size: formatBytes(usage.storageQuota) })
            }}{{ usage.quota !== null ? $t('staff.user.ownQuota') : '' }}</span
          >
          <UiProgress
            class="mt-1"
            :value="usage.storedBytes"
            :max="usage.storageQuota"
            :tone="quotaShare >= 0.8 ? 'danger' : 'accent'"
            :label="$t('staff.user.storageUsed')"
          />
        </template>
      </UiStat>
      <UiStat
        v-if="usage"
        :label="$t('staff.user.today')"
        :value="`${formatNumber(usage.daySnapshots)} / ${formatNumber(usage.dailySnapshots)}`"
        :hint="
          $t('staff.user.todayHint', {
            day: formatBytes(usage.dayBytes),
            daily: formatBytes(usage.dailyBytes),
          })
        "
      >
        <span v-if="capHit" class="text-sm text-warning-text">{{
          $t('staff.user.dailyCapHit')
        }}</span>
      </UiStat>
    </div>

    <div class="grid items-start gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div class="flex min-w-0 flex-col gap-6">
        <UiPanel :title="$t('staff.user.data')">
          <template #actions>
            <span
              class="tabular font-mono text-sm text-text-muted"
              :title="$t('staff.storage.rawTitle')"
              >{{ formatBytes(user.storedBytes + detail.liveBytes) }} ·
              {{ $t('staff.storage.rawOf', { size: formatBytes(user.rawBytes) }) }}</span
            >
          </template>
          <div class="flex flex-col gap-4">
            <StorageSplitBar
              :split="{ ...user, liveBytes: detail.liveBytes }"
              :label="$t('staff.split.of', { name: user.username })"
            />
            <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <UiStat :label="$t('staff.split.sections')" :value="formatBytes(user.sectionBytes)">
                <template #icon>
                  <span class="size-2.5 rounded-sm bg-chart-1" aria-hidden="true" />
                </template>
                <span class="tabular font-mono text-sm text-text-muted">{{
                  $t('staff.storage.snapshotCount', { n: formatNumber(user.snapshots) })
                }}</span>
              </UiStat>
              <UiStat :label="$t('staff.split.catalog')" :value="formatBytes(user.catalogBytes)">
                <template #icon>
                  <span class="size-2.5 rounded-sm bg-chart-4" aria-hidden="true" />
                </template>
                <span class="tabular font-mono text-sm text-text-muted">{{
                  $t('staff.storage.pieces', { n: formatNumber(catalogCount) })
                }}</span>
              </UiStat>
              <UiStat :label="$t('staff.split.wishes')" :value="formatBytes(user.wishBytes)">
                <template #icon>
                  <span class="size-2.5 rounded-sm bg-chart-2" aria-hidden="true" />
                </template>
                <span class="tabular font-mono text-sm text-text-muted"
                  >{{ $t('staff.split.pulls', { n: formatNumber(user.wishPulls) })
                  }}<template v-if="user.wishPulls">
                    · {{ $t('staff.storage.perPull', { n: perPull(user) }) }}</template
                  ></span
                >
              </UiStat>
              <UiStat :label="$t('staff.split.live')" :value="formatBytes(detail.liveBytes)">
                <template #icon>
                  <span class="size-2.5 rounded-sm bg-text-muted" aria-hidden="true" />
                </template>
                <span class="tabular font-mono text-sm text-text-muted">{{
                  detail.liveBytes ? $t('staff.user.liveHint') : $t('staff.user.noJournal')
                }}</span>
              </UiStat>
            </div>
          </div>
        </UiPanel>

        <UiPanel flush>
          <template #header>
            <h2 class="text-base font-semibold">{{ $t('staff.user.genshinAccounts') }}</h2>
            <span class="tabular font-mono text-sm text-text-muted">{{
              formatNumber(detail.accounts.length)
            }}</span>
          </template>
          <p v-if="detail.accounts.length === 0" class="px-5 py-6 text-sm text-text-muted">
            {{ $t('staff.common.none') }}
          </p>
          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[44rem] text-sm">
              <thead
                class="border-b border-border-default bg-surface-overlay/50 text-text-secondary"
              >
                <tr>
                  <th scope="col" class="px-4 py-2 text-left font-medium">
                    {{ $t('staff.user.name') }}
                  </th>
                  <th scope="col" class="px-3 py-2 text-left font-medium">UID</th>
                  <th scope="col" class="px-3 py-2 text-left font-medium">
                    {{ $t('staff.user.server') }}
                  </th>
                  <th scope="col" class="px-3 py-2 text-right font-medium">
                    {{ $t('staff.common.snapshots') }}
                  </th>
                  <th scope="col" class="px-3 py-2 text-left font-medium">
                    {{ $t('staff.user.lastUpload') }}
                  </th>
                  <th
                    scope="col"
                    class="px-3 py-2 text-right font-medium"
                    :title="$t('staff.common.wishesTitle')"
                  >
                    {{ $t('staff.common.wishes') }}
                  </th>
                  <th scope="col" class="px-3 py-2 text-left font-medium">
                    {{ $t('staff.user.lastWishSync') }}
                  </th>
                  <th
                    scope="col"
                    class="px-3 py-2 text-right font-medium"
                    :title="$t('staff.common.storedTitle')"
                  >
                    {{ $t('staff.common.stored') }}
                  </th>
                  <th scope="col" class="px-3 py-2">
                    <span class="sr-only">{{ $t('staff.common.actions') }}</span>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border-subtle">
                <tr v-for="account in accounts" :key="account.id">
                  <td class="max-w-48 truncate px-4 py-1.5 font-medium">
                    {{ account.name || '—' }}
                  </td>
                  <td class="tabular px-3 py-1.5 font-mono text-text-secondary">
                    {{ account.uid ?? '—' }}
                  </td>
                  <td class="px-3 py-1.5 text-text-secondary">
                    {{ serverName(account.server) || '—' }}
                  </td>
                  <td
                    class="tabular px-3 py-1.5 text-right font-mono"
                    :title="
                      account.trash
                        ? $t('staff.user.inTrash', { n: formatNumber(account.trash) })
                        : undefined
                    "
                  >
                    {{ formatNumber(account.snapshotCount) }}
                  </td>
                  <td
                    class="tabular px-3 py-1.5 whitespace-nowrap text-text-secondary"
                    :title="account.lastUploadAt ? formatDateTime(account.lastUploadAt) : undefined"
                  >
                    {{ account.lastUploadAt ? formatRelative(account.lastUploadAt) : '—' }}
                  </td>
                  <td
                    class="tabular px-3 py-1.5 text-right font-mono"
                    :title="
                      account.wishPulls
                        ? `${$t('staff.split.pulls', { n: formatNumber(account.wishPulls) })} · ${formatBytes(account.wishBytes)}`
                        : undefined
                    "
                  >
                    <span
                      v-if="account.wishPulls"
                      class="inline-flex flex-col items-end leading-tight"
                    >
                      <span>{{ formatNumber(account.wishPulls) }}</span>
                      <span class="text-xs text-text-muted">{{
                        formatBytes(account.wishBytes)
                      }}</span>
                    </span>
                    <span v-else class="text-text-muted">—</span>
                  </td>
                  <td
                    class="tabular px-3 py-1.5 whitespace-nowrap text-text-secondary"
                    :title="
                      account.wishUpdatedAt ? formatDateTime(account.wishUpdatedAt) : undefined
                    "
                  >
                    {{ account.wishUpdatedAt ? formatRelative(account.wishUpdatedAt) : '—' }}
                  </td>
                  <td
                    class="tabular px-3 py-1.5 text-right font-mono"
                    :title="
                      [
                        `${$t('staff.split.sections')} ${formatBytes(account.storedBytes)}`,
                        `${$t('staff.split.catalog')} ${formatBytes(account.catalogBytes)}`,
                        `${$t('staff.split.wishes')} ${formatBytes(account.wishBytes)}`,
                      ].join(' · ')
                    "
                  >
                    {{
                      formatBytes(account.storedBytes + account.catalogBytes + account.wishBytes)
                    }}
                  </td>
                  <td class="px-2 py-1 text-right whitespace-nowrap">
                    <span class="inline-flex items-center gap-1">
                      <UiButton
                        v-if="may('data.inspect')"
                        variant="ghost"
                        size="sm"
                        :to="{
                          name: 'staff-inspect-overview',
                          params: { accountId: account.id },
                        }"
                      >
                        <Eye class="size-4" aria-hidden="true" />
                        {{ $t('staff.user.inspect') }}
                      </UiButton>
                      <ActionMenu
                        :label="
                          $t('staff.common.moreFor', {
                            name: account.name || account.uid || $t('staff.user.thisAccount'),
                          })
                        "
                        :items="accountMenu(account)"
                      />
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div
            v-if="detail.accounts.length > ACCOUNTS_SHOWN"
            class="border-t border-border-default px-5 py-3"
          >
            <button
              type="button"
              class="text-sm font-medium text-accent-text hover:underline"
              @click="showAll = !showAll"
            >
              {{
                showAll
                  ? $t('staff.user.showFewer')
                  : $t('staff.user.showMore', {
                      n: formatNumber(detail.accounts.length - ACCOUNTS_SHOWN),
                    })
              }}
            </button>
          </div>
        </UiPanel>

        <UiPanel v-if="detail.sessions" :title="$t('staff.user.sessions')" flush>
          <template v-if="may('users.sessions') && detail.sessions.length" #actions>
            <UiButton variant="ghost" size="sm" :disabled="busy" @click="signOutAll">
              {{ $t('staff.user.signOutAll') }}
            </UiButton>
          </template>
          <p v-if="detail.sessions.length === 0" class="px-5 py-6 text-sm text-text-muted">
            {{ $t('staff.user.signedInNowhere') }}
          </p>
          <ul v-else class="divide-y divide-border-subtle text-sm">
            <li
              v-for="s in detail.sessions"
              :key="s.id"
              class="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5"
            >
              <component
                :is="onPhone(s) ? Smartphone : Monitor"
                class="size-5 shrink-0 text-text-secondary"
                aria-hidden="true"
              />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="font-medium">{{ deviceName(s) }}</span>
                <span class="text-[0.8125rem] text-text-muted">
                  <span class="font-code">{{ s.ip ?? '—' }}</span>
                  · {{ [s.city, s.country].filter(Boolean).join(', ') || '—' }} ·
                  {{ methodLabel(s.method) }}
                </span>
              </span>
              <span class="tabular text-text-secondary" :title="formatDateTime(s.lastSeenAt)">{{
                formatRelative(s.lastSeenAt)
              }}</span>
              <UiButton
                v-if="may('users.sessions')"
                variant="ghost"
                size="sm"
                :disabled="busy"
                @click="signOutSession(s.id)"
              >
                {{ $t('staff.user.signOut') }}
              </UiButton>
            </li>
          </ul>
        </UiPanel>
      </div>

      <div class="flex min-w-0 flex-col gap-6">
        <UiPanel :title="$t('staff.user.signIn')" flush>
          <dl class="divide-y divide-border-subtle px-5 text-sm">
            <div class="flex items-center gap-3 py-2.5">
              <dt class="w-24 shrink-0 text-text-secondary">{{ $t('staff.user.password') }}</dt>
              <dd class="flex-1">{{ user.hasPassword ? $t('staff.common.set') : '—' }}</dd>
            </div>
            <div v-if="user.email !== undefined" class="flex items-center gap-3 py-2.5">
              <dt class="w-24 shrink-0 text-text-secondary">{{ $t('staff.user.email') }}</dt>
              <dd class="min-w-0 flex-1 truncate" :class="user.email ? '' : 'text-text-muted'">
                {{ user.email ?? '—' }}
                <UiBadge v-if="user.email && user.emailVerified" tone="success" class="ml-1">{{
                  $t('staff.user.confirmed')
                }}</UiBadge>
              </dd>
            </div>
            <template v-if="detail.identities">
              <div
                v-for="row in identities"
                :key="row.provider"
                class="flex items-center gap-3 py-2.5"
              >
                <dt class="flex w-24 shrink-0 items-center gap-1.5 text-text-secondary">
                  <ProviderMark :provider="row.provider" class="size-3.5" />
                  {{ providerLabel(row.provider) }}
                </dt>
                <dd v-if="row.identity" class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
                  <span class="truncate font-medium">{{
                    row.identity.displayName ?? row.identity.email ?? $t('staff.user.linked')
                  }}</span>
                  <span
                    class="text-[0.8125rem] text-text-muted"
                    :title="
                      $t('staff.user.linkedAt', { date: formatDateTime(row.identity.createdAt) })
                    "
                    >{{
                      row.identity.lastUsedAt
                        ? $t('staff.user.used', { when: formatRelative(row.identity.lastUsedAt) })
                        : $t('staff.user.neverUsed')
                    }}</span
                  >
                </dd>
                <dd v-else class="flex-1 text-text-muted">—</dd>
                <UiButton
                  v-if="row.identity && may('users.identities')"
                  variant="ghost"
                  size="sm"
                  :disabled="busy"
                  @click="unlink(row.provider)"
                >
                  <Unlink class="size-4" aria-hidden="true" />
                  {{ $t('staff.user.unlink') }}
                </UiButton>
              </div>
            </template>
            <div v-if="user.api" class="flex items-center gap-3 py-2.5">
              <dt class="w-24 shrink-0 text-text-secondary">{{ $t('staff.apiLimits.title') }}</dt>
              <dd class="flex-1">
                {{ $t(`staff.apiLimits.${user.api.tier}`) }}
                <span v-if="user.api.override?.global" class="text-text-muted tabular-nums">
                  · {{ $t('staff.apiLimits.perMinute', { n: user.api.override.global }) }}</span
                >
              </dd>
              <UiButton
                v-if="may('data.manage') && detail.outranked"
                variant="ghost"
                size="sm"
                :disabled="busy"
                @click="apiLimitsOpen = true"
              >
                {{ $t('staff.apiLimits.change') }}
              </UiButton>
            </div>
            <div class="flex items-center gap-3 py-2.5">
              <dt class="w-24 shrink-0 text-text-secondary" :title="$t('staff.user.userKeyTitle')">
                {{ $t('staff.user.userKey') }}
              </dt>
              <dd class="flex-1" :class="user.hasImportKey ? '' : 'text-text-muted'">
                {{ user.hasImportKey ? $t('staff.common.set') : '—' }}
              </dd>
              <UiButton
                v-if="user.hasImportKey && may('data.manage')"
                variant="ghost"
                size="sm"
                :disabled="busy"
                @click="revokeUserKey"
              >
                {{ $t('staff.user.revoke') }}
              </UiButton>
            </div>
          </dl>
        </UiPanel>

        <UiPanel v-if="detail.history" :title="$t('staff.user.staffHistory')" flush>
          <template #actions>
            <UiButton
              variant="ghost"
              size="sm"
              :to="{ name: 'staff-audit', query: { user: String(user.id) } }"
            >
              {{ $t('staff.common.all') }}
            </UiButton>
          </template>
          <p v-if="detail.history.length === 0" class="px-5 py-6 text-sm text-text-muted">
            {{ $t('staff.common.none') }}
          </p>
          <ul v-else class="divide-y divide-border-subtle text-sm">
            <li v-for="h in detail.history" :key="h.id" class="flex items-start gap-3 px-5 py-2.5">
              <span class="tabular w-24 shrink-0 text-text-muted" :title="formatDateTime(h.at)">{{
                formatRelative(h.at)
              }}</span>
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="text-text-secondary">
                  <span class="font-medium text-text-primary">{{ h.actor.label }}</span>
                  {{ auditPhrase(h.action, h.detail) }}
                </span>
                <span
                  v-if="typeof h.detail.reason === 'string' && h.detail.reason"
                  class="text-[0.8125rem] text-text-muted"
                  >“{{ h.detail.reason }}”</span
                >
              </span>
            </li>
          </ul>
        </UiPanel>
      </div>
    </div>
  </div>

  <ResetLinkDialog
    :open="resetOpen"
    :user="target"
    :identities="detail?.identities"
    @close="resetOpen = false"
  />
  <ReasonDialog
    :open="suspendOpen"
    :title="$t('staff.common.suspend')"
    :user="target"
    :effects="[
      $t('staff.effects.signsOut'),
      $t('staff.effects.blocksSignIn'),
      $t('staff.effects.keepsData'),
    ]"
    :confirm-label="$t('staff.common.suspend')"
    :busy="busy"
    @close="suspendOpen = false"
    @confirm="suspend"
  />
  <ReasonDialog
    :open="blockOpen"
    :title="$t('staff.common.blockUploads')"
    :user="target"
    :effects="[
      $t('staff.effects.refusesUploads'),
      $t('staff.effects.canStillSignIn'),
      $t('staff.effects.keepsData'),
    ]"
    :confirm-label="$t('staff.common.blockUploads')"
    :busy="busy"
    @close="blockOpen = false"
    @confirm="(reason) => setUploads(true, reason)"
  />
  <RenameDialog
    :open="renameOpen"
    :user="target"
    :busy="busy"
    :error="renameError"
    @close="renameOpen = false"
    @confirm="rename"
  />
  <DeleteUserDialog
    :open="deleteOpen"
    :user="target"
    :figures="
      user
        ? { accounts: user.accounts, snapshots: user.snapshots, storedBytes: user.storedBytes }
        : undefined
    "
    :busy="busy"
    @close="deleteOpen = false"
    @confirm="remove"
  />
  <ApiLimitsDialog
    v-if="user?.api"
    :open="apiLimitsOpen"
    :tier="user.api.tier"
    :override="user.api.override"
    :busy="busy"
    @close="apiLimitsOpen = false"
    @confirm="setApiLimits"
  />
  <QuotaDialog
    :open="quotaOpen"
    :quota="usage?.quota ?? null"
    :default-quota="usage?.siteQuota ?? 0"
    :busy="busy"
    @close="quotaOpen = false"
    @confirm="setQuota"
  />
  <DeleteDataDialog
    :open="dataAccount !== null"
    :account="dataAccount"
    :busy="busy"
    @close="dataAccount = null"
    @purge="purge"
    @delete-account="deleteAccount"
  />
</template>
