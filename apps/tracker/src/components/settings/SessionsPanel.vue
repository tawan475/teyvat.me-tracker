<script setup lang="ts">
import type { SessionResponse, UploadTarget } from '@gdt/shared'
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LogOut } from 'lucide-vue-next'
import ProviderMark from '@/components/oauth/ProviderMark.vue'
import DeviceAlerts from '@/components/settings/DeviceAlerts.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSelect, { type SelectGroup, type SelectOption } from '@/components/ui/UiSelect.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { ApiRequestError, api } from '@/api'
import { t } from '@/i18n'
import { formatDateTime, formatRelative } from '@/lib/format'
import { useAccounts } from '@/stores/accounts'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'
import { byRecent, deviceName, devicePlace, methodIcon, methodTitle } from './devices'

/**
 * The devices signed in to this account (each sign-in is one): where each
 * was last seen and when, with Sign out per device, for every other device,
 * and here. A device signed out elsewhere loses its live updates at once and
 * is signed out on its next request. Irminsul's sessions also pick where
 * their uploads go (irminsul's Configure button opens `?device=<id>`, which
 * scrolls to that row).
 */
const session = useSession()
const accounts = useAccounts()
const feedback = useFeedback()
const router = useRouter()
const route = useRoute()

const sessions = ref<SessionResponse[] | null>(null)
/** The session being signed out, 'others', or 'here'. */
const busy = ref<number | 'others' | 'here' | null>(null)

/** The device irminsul's Configure button asked for (`?device=`), highlighted. */
const focused = computed(() => {
  const id = Number(route.query.device)
  return Number.isSafeInteger(id) && id > 0 ? id : null
})
/** The irminsul session whose upload target is being saved. */
const saving = ref<number | null>(null)

/** Upload target options: by UID, or one of the accounts (a removed one only while chosen). */
function targetOptions(row: SessionResponse): (SelectOption<string> | SelectGroup<string>)[] {
  const options: (SelectOption<string> | SelectGroup<string>)[] = [
    { value: 'uid', label: t('settings.devices.auto') },
  ]
  if (targetKey(row) === 'gone') {
    options.push({ value: 'gone', label: t('settings.devices.removedAccount') })
  }
  // Accounts this user may upload to: their own and those shared with them as editor.
  const writable = accounts.list.filter((a) => a.access !== 'viewer')
  if (writable.length) {
    options.push({
      group: t('settings.devices.always'),
      options: writable.map((a) => ({ value: String(a.id), label: accounts.displayName(a) })),
    })
  }
  return options
}

/**
 * Live sync for where an irminsul device's uploads go (chosen per account in
 * its settings): the accounts it is on for, or null when none.
 */
function liveTargets(row: SessionResponse): string[] | null {
  if (row.method !== 'irminsul') return null
  const upload = row.upload
  const targets =
    !upload || upload.mode === 'uid'
      ? accounts.list
      : accounts.list.filter((a) => a.id === upload.accountId)
  const on = targets.filter((a) => a.liveSync).map((a) => accounts.displayName(a))
  return on.length ? on : null
}

/** The select's value for a row's target. */
function targetKey(row: SessionResponse): string {
  const upload = row.upload
  if (!upload || upload.mode === 'uid') return 'uid'
  return upload.accountId !== null && accounts.byId.has(upload.accountId)
    ? String(upload.accountId)
    : 'gone'
}

async function setTarget(row: SessionResponse, key: string) {
  if (key === 'gone' || key === targetKey(row)) return
  const upload: UploadTarget =
    key === 'uid' ? { mode: 'uid' } : { mode: 'account', account_id: Number(key) }
  saving.value = row.id
  try {
    const saved = await api.setSessionUpload(row.id, upload)
    const held = sessions.value?.find((s) => s.id === row.id)
    if (held) held.upload = saved.upload
    feedback.toast({
      tone: 'success',
      title: t('settings.devices.targetSaved'),
      hint: deviceName(row),
    })
  } catch (cause) {
    feedback.error(t('settings.devices.targetNotSaved'), cause)
    await load()
  } finally {
    saving.value = null
  }
}

/** A row's alerts or push subscription changed (DeviceAlerts). */
function patchRow(id: number, patch: Partial<SessionResponse>) {
  const held = sessions.value?.find((s) => s.id === id)
  if (held) Object.assign(held, patch)
}

/** This device first, then the most recently seen. */
const rows = computed(() =>
  [...(sessions.value ?? [])]
    .sort(byRecent)
    .map((row) => ({ ...row, device: deviceName(row), place: devicePlace(row) })),
)

async function load() {
  try {
    sessions.value = await api.sessions()
  } catch (cause) {
    feedback.error(t('settings.devices.notLoaded'), cause)
  }
}

onMounted(async () => {
  await load()
  if (focused.value === null) return
  await nextTick()
  document
    .getElementById(`device-${focused.value}`)
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})

function details(row: SessionResponse): string {
  return [
    methodTitle(row.method),
    t('settings.devices.since', { date: formatDateTime(row.createdAt) }),
    t('settings.devices.lastActive', { date: formatDateTime(row.lastSeenAt) }),
  ].join('\n')
}

async function signOutDevice(row: SessionResponse & { device: string }) {
  const ok = await feedback.confirm({
    title: t('settings.devices.signOutTitle', { device: row.device }),
    detail: t('settings.devices.signOutDetail'),
    confirmLabel: t('common.signOut'),
    tone: 'danger',
  })
  if (!ok) return
  busy.value = row.id
  try {
    await api.revokeSession(row.id)
    feedback.toast({ tone: 'success', title: t('settings.devices.signedOut'), hint: row.device })
  } catch (cause) {
    // Gone already (it signed out, or ran out): the list catches up below.
    if (!(cause instanceof ApiRequestError && cause.status === 404)) {
      feedback.error(t('settings.devices.notSignedOut'), cause)
    }
  } finally {
    busy.value = null
    await load()
  }
}

async function signOutOthers() {
  const ok = await feedback.confirm({
    title: t('settings.devices.othersTitle'),
    detail: t('settings.devices.othersDetail'),
    confirmLabel: t('settings.devices.othersConfirm'),
    tone: 'danger',
  })
  if (!ok) return
  busy.value = 'others'
  try {
    await api.revokeOtherSessions()
    feedback.toast({ tone: 'success', title: t('settings.devices.othersDone') })
  } catch (cause) {
    feedback.error(t('settings.devices.othersFailed'), cause)
  } finally {
    busy.value = null
    await load()
  }
}

async function signOut() {
  busy.value = 'here'
  try {
    await session.logout()
  } catch (error) {
    // The store has already forgotten the session; say the server did not hear it.
    feedback.error(t('settings.devices.hereFailed'), error)
  } finally {
    accounts.clear()
    busy.value = null
    await router.push({ name: 'login' })
  }
}
</script>

<template>
  <UiPanel id="devices" :title="$t('settings.devices.title')">
    <ul v-if="sessions" class="flex flex-col divide-y divide-border-subtle">
      <li
        v-for="row in rows"
        :id="`device-${row.id}`"
        :key="row.id"
        class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
        :class="
          row.id === focused
            ? 'rounded-lg ring-2 ring-accent ring-offset-4 ring-offset-surface-raised'
            : ''
        "
      >
        <div class="flex min-w-0 items-center gap-3">
          <span class="shrink-0 text-text-muted" :title="methodTitle(row.method)">
            <ProviderMark
              v-if="row.method === 'discord' || row.method === 'google'"
              :provider="row.method"
              class="size-4"
            />
            <component :is="methodIcon(row)" v-else class="size-4" aria-hidden="true" />
            <span class="sr-only">{{ methodTitle(row.method) }}</span>
          </span>
          <div class="min-w-0" :title="details(row)">
            <p class="flex min-w-0 items-center gap-2">
              <span class="truncate font-medium" :title="row.userAgent ?? undefined">
                {{ row.device }}
              </span>
              <UiBadge v-if="row.current" tone="accent">{{
                $t('settings.devices.thisDevice')
              }}</UiBadge>
              <UiBadge
                v-if="liveTargets(row)"
                tone="success"
                :title="$t('live.settings.devices', { accounts: liveTargets(row)!.join(', ') })"
                >{{ $t('live.label') }}</UiBadge
              >
            </p>
            <p class="truncate text-sm text-text-muted">
              <span class="tabular">{{ row.place || $t('settings.devices.unknownPlace') }}</span>
              <template v-if="!row.current"> · {{ formatRelative(row.lastSeenAt) }}</template>
            </p>
          </div>
        </div>
        <UiSelect
          v-if="row.method === 'irminsul'"
          :model-value="targetKey(row)"
          :options="targetOptions(row)"
          :disabled="saving === row.id || busy !== null"
          class="order-last w-full sm:order-none sm:ml-auto sm:w-64"
          :aria-label="$t('settings.devices.uploadsGoTo')"
          :title="$t('settings.devices.uploadsTitle')"
          @update:model-value="(key) => setTarget(row, key)"
        />
        <DeviceAlerts :row="row" @changed="(patch) => patchRow(row.id, patch)" />
        <UiButton
          v-if="!row.current"
          size="sm"
          :loading="busy === row.id"
          :disabled="busy !== null"
          @click="signOutDevice(row)"
        >
          {{ $t('common.signOut') }}
        </UiButton>
      </li>
    </ul>
    <div v-else class="flex flex-col gap-3" aria-busy="true">
      <UiSkeleton v-for="n in 2" :key="n" class="h-10 w-full" />
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
      <UiButton
        :loading="busy === 'others'"
        :disabled="busy !== null"
        :title="$t('settings.devices.othersButtonTitle')"
        @click="signOutOthers"
      >
        {{ $t('settings.devices.othersButton') }}
      </UiButton>
      <UiButton :loading="busy === 'here'" :disabled="busy !== null" @click="signOut">
        <LogOut v-if="busy !== 'here'" class="size-4" aria-hidden="true" />
        {{ $t('common.signOut') }}
      </UiButton>
    </div>
  </UiPanel>
</template>
