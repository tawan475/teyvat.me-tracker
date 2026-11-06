<script setup lang="ts">
import gameData from '@gdt/game-data/data/meta.json'
import type { DomainEventWindow, SignupMode, StaffSiteResponse } from '@gdt/shared'
import { computed, ref } from 'vue'
import DomainEventsDialog from '@/components/staff/DomainEventsDialog.vue'
import LimitsDialog, { type LimitsPatch } from '@/components/staff/LimitsDialog.vue'
import MethodMarks from '@/components/staff/MethodMarks.vue'
import StackedBars from '@/components/staff/StackedBars.vue'
import StorageSplitBar from '@/components/staff/StorageSplitBar.vue'
import UserLink from '@/components/staff/UserLink.vue'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiError from '@/components/ui/UiError.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiStat from '@/components/ui/UiStat.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { formatBytes, formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'

/**
 * Staff overview: totals, 30 days of sign-ups (by how they signed up) and
 * uploads, the newest sign-ups (a burst from one address stands out), and
 * the site's switches.
 */
const session = useSession()
const feedback = useFeedback()
const { data, error, reload } = useResource(
  () => true,
  () => api.staff.overview(),
)
const site = ref<StaffSiteResponse | null>(null)
const shownSite = computed(() => site.value ?? data.value?.site ?? null)

const signupSeries = computed(() => [
  { key: 'password', label: t('staff.methods.password'), color: 'var(--chart-2)' },
  { key: 'discord', label: 'Discord', color: 'var(--chart-1)' },
  { key: 'google', label: 'Google', color: 'var(--chart-3)' },
])
const uploadSeries = computed(() => [
  { key: 'stored', label: t('staff.common.stored'), color: 'var(--chart-4)' },
])

const MODES: SignupMode[] = ['open', 'oauth', 'closed']
const modeLabel = (mode: SignupMode) => t(`staff.overview.modes.${mode}`)
const canSettings = computed(() => session.can('site.settings'))
const modeOptions = computed(() =>
  MODES.map((value) => ({
    value,
    label: modeLabel(value),
    title: t(`staff.overview.modes.${value}Title`),
    disabled: !canSettings.value && value !== shownSite.value?.signupMode,
  })),
)
const saving = ref(false)

async function setMode(mode: SignupMode) {
  if (!canSettings.value || mode === shownSite.value?.signupMode) return
  saving.value = true
  try {
    site.value = await api.staff.updateSite({ signupMode: mode })
    feedback.toast({
      tone: 'success',
      title: t('staff.overview.modeSaved', { mode: modeLabel(mode) }),
    })
  } catch (cause) {
    feedback.error(t('staff.common.notSaved'), cause)
  } finally {
    saving.value = false
  }
}
const signupMode = computed({
  get: () => shownSite.value?.signupMode ?? 'open',
  set: (mode: SignupMode) => void setMode(mode),
})

const limitsOpen = ref(false)
async function saveLimits(patch: LimitsPatch) {
  saving.value = true
  try {
    site.value = await api.staff.updateSite(patch)
    limitsOpen.value = false
    feedback.toast({ tone: 'success', title: t('staff.overview.limitsSaved') })
  } catch (cause) {
    feedback.error(t('staff.common.notSaved'), cause)
  } finally {
    saving.value = false
  }
}

const eventsOpen = ref(false)
async function saveEvents(events: DomainEventWindow[]) {
  saving.value = true
  try {
    site.value = await api.staff.updateSite({ domainEvents: events })
    eventsOpen.value = false
    feedback.toast({ tone: 'success', title: t('staff.events.saved') })
  } catch (cause) {
    feedback.error(t('staff.common.notSaved'), cause)
  } finally {
    saving.value = false
  }
}
/** "Overflowing Abundance 10-13 04:00 → 10-20 04:00", one per window. */
const eventLines = computed(() =>
  (shownSite.value?.domainEvents ?? []).map(
    (e) =>
      `${t(`farm.event.names.${e.kind}`)} ${e.start.slice(5).replace('T', ' ')} → ${e.end.slice(5).replace('T', ' ')}`,
  ),
)

const syncing = ref(false)
async function syncEvents() {
  syncing.value = true
  try {
    site.value = await api.staff.syncEvents()
  } catch (cause) {
    feedback.error(t('staff.events.syncFailed'), cause)
  } finally {
    syncing.value = false
  }
}
/** "board 17 · HoYoLAB 7" (one server's count: they match). */
const syncCounts = computed(() => {
  const counts = shownSite.value?.eventsSync?.counts ?? {}
  const board =
    counts['board:ASIA'] ?? Object.entries(counts).find(([k]) => k.startsWith('board:'))?.[1]
  return [
    board === undefined ? '' : t('staff.events.boardCount', { n: formatNumber(board) }),
    counts.hoyolab === undefined
      ? ''
      : t('staff.events.hoyolabCount', { n: formatNumber(counts.hoyolab) }),
  ]
    .filter(Boolean)
    .join(' · ')
})

const storedShare = computed(() => {
  const bytes = data.value?.storedBytes ?? 0
  // D1's 10 GB.
  return `${((bytes / (10 * 1024 ** 3)) * 100).toFixed(2)}%`
})

const emailTone = (state: StaffSiteResponse['email']) =>
  state === 'on' ? 'success' : state === 'paused' ? 'warning' : 'neutral'
</script>

<template>
  <PageHeader :title="$t('staff.overview.title')" />

  <UiError
    v-if="error && !data"
    :error="error"
    :title="$t('staff.common.couldNotLoad')"
    @retry="reload"
  />

  <div v-else-if="!data" class="flex flex-col gap-6" aria-busy="true">
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <UiSkeleton v-for="n in 6" :key="n" class="h-20" />
    </div>
    <UiSkeleton class="h-64" />
  </div>

  <div v-else class="flex flex-col gap-6">
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <UiStat :label="$t('staff.overview.users')" :value="data.users.total">
        <span
          v-if="data.users.today"
          class="tabular font-mono text-sm text-success-text"
          :title="$t('staff.overview.signedUpToday')"
          >+{{ formatNumber(data.users.today) }}</span
        >
      </UiStat>
      <UiStat
        :label="$t('staff.overview.active7d')"
        :value="data.active7d"
        :hint="$t('staff.overview.active7dHint')"
      />
      <UiStat :label="$t('staff.common.accounts')" :value="data.accounts" />
      <UiStat :label="$t('staff.common.snapshots')" :value="data.snapshots.total">
        <span
          v-if="data.snapshots.today"
          class="tabular font-mono text-sm text-success-text"
          :title="$t('staff.overview.storedToday')"
          >+{{ formatNumber(data.snapshots.today) }}</span
        >
      </UiStat>
      <UiStat
        :label="$t('staff.common.stored')"
        :value="formatBytes(data.storedBytes)"
        :hint="$t('staff.common.d1Share', { share: storedShare })"
      >
        <StorageSplitBar
          class="mt-1"
          :split="data.storage"
          :label="$t('staff.storage.siteSplit')"
        />
        <span class="tabular font-mono text-sm text-text-muted"
          >{{ storedShare }} ·
          {{ $t('staff.split.pulls', { n: formatNumber(data.storage.wishPulls) }) }}</span
        >
      </UiStat>
      <RouterLink
        v-if="session.can('users.view')"
        :to="{ name: 'staff-users', query: { filter: 'suspended' } }"
        class="flex rounded-xl transition-opacity hover:opacity-80"
        :title="$t('staff.overview.suspendedUsers')"
      >
        <UiStat
          :label="$t('staff.common.suspended')"
          :value="data.suspended"
          :tone="data.suspended ? 'warning' : undefined"
        />
      </RouterLink>
      <UiStat v-else :label="$t('staff.common.suspended')" :value="data.suspended" />
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <UiPanel :title="$t('staff.overview.signups30')">
        <StackedBars
          :days="data.signups"
          :series="signupSeries"
          :label="$t('staff.overview.signupsChart')"
        />
      </UiPanel>
      <UiPanel :title="$t('staff.overview.uploads30')">
        <StackedBars
          :days="data.uploads"
          :series="uploadSeries"
          :label="$t('staff.overview.uploadsChart')"
        />
      </UiPanel>
    </div>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <UiPanel v-if="data.recent" :title="$t('staff.overview.recent')" flush>
        <template #actions>
          <UiButton
            variant="ghost"
            size="sm"
            :to="{ name: 'staff-users', query: { filter: 'new' } }"
          >
            {{ $t('staff.overview.allUsers') }}
          </UiButton>
        </template>
        <ul class="divide-y divide-border-subtle text-sm">
          <li
            v-for="r in data.recent"
            :key="r.id"
            class="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5"
            :class="r.sameIp > 0 ? 'bg-amber-500/10' : ''"
          >
            <UserLink :user="r" class="min-w-0 basis-full sm:flex-1 sm:basis-0" />
            <MethodMarks :methods="[r.method]" />
            <span
              v-if="r.signupIp"
              class="truncate font-code text-[0.8125rem] text-text-secondary sm:w-32"
              >{{ r.signupIp }}</span
            >
            <UiBadge v-if="r.signupCountry" mono>{{ r.signupCountry }}</UiBadge>
            <span
              class="tabular text-text-muted sm:w-28 sm:text-right"
              :title="formatDateTime(r.createdAt)"
              >{{ formatRelative(r.createdAt) }}</span
            >
            <span class="tabular text-text-secondary sm:w-24 sm:text-right">{{
              $t('staff.overview.accountCount', { n: formatNumber(r.accounts) }, r.accounts)
            }}</span>
            <UiBadge v-if="r.sameIp > 0" tone="warning" :title="$t('staff.overview.sameIpTitle')">{{
              $t('staff.overview.sameIp', { n: r.sameIp })
            }}</UiBadge>
          </li>
        </ul>
      </UiPanel>

      <UiPanel v-if="shownSite" :title="$t('staff.overview.site')">
        <div class="flex flex-col gap-5">
          <div class="flex flex-col gap-2">
            <span class="text-sm font-medium text-text-secondary">{{
              $t('staff.overview.signups')
            }}</span>
            <UiSegmented
              v-model="signupMode"
              :options="modeOptions"
              :label="$t('staff.overview.signups')"
              class="self-start"
            />
          </div>
          <dl class="flex flex-col divide-y divide-border-subtle text-sm">
            <div class="flex items-center gap-3 py-2.5">
              <dt class="w-28 shrink-0 text-text-secondary sm:w-36">
                {{ $t('staff.overview.dailySnapshots') }}
              </dt>
              <dd class="tabular flex-1">
                {{
                  $t('staff.overview.perUser', {
                    value: formatNumber(shownSite.limits.dailySnapshots),
                  })
                }}
              </dd>
            </div>
            <div class="flex items-center gap-3 py-2.5">
              <dt class="w-28 shrink-0 text-text-secondary sm:w-36">
                {{ $t('staff.overview.dailyStorage') }}
              </dt>
              <dd class="tabular flex-1">
                {{
                  $t('staff.overview.perUser', { value: formatBytes(shownSite.limits.dailyBytes) })
                }}
              </dd>
            </div>
            <div class="flex items-center gap-3 py-2.5">
              <dt class="w-28 shrink-0 text-text-secondary sm:w-36">
                {{ $t('staff.overview.storageQuota') }}
              </dt>
              <dd class="tabular flex-1">
                {{
                  $t('staff.overview.perUser', {
                    value: formatBytes(shownSite.limits.storageQuota),
                  })
                }}
              </dd>
              <UiButton v-if="canSettings" variant="ghost" size="sm" @click="limitsOpen = true">
                {{ $t('staff.common.edit') }}
              </UiButton>
            </div>
            <div class="flex items-center gap-3 py-2.5">
              <dt
                class="w-28 shrink-0 text-text-secondary sm:w-36"
                :title="$t('staff.events.hint')"
              >
                {{ $t('staff.events.title') }}
              </dt>
              <dd class="tabular flex min-w-0 flex-1 flex-col gap-0.5">
                <span v-for="line in eventLines" :key="line" class="truncate" :title="line">{{
                  line
                }}</span>
                <span v-if="eventLines.length === 0" class="text-text-muted">{{
                  $t('staff.events.none')
                }}</span>
              </dd>
              <UiButton v-if="canSettings" variant="ghost" size="sm" @click="eventsOpen = true">
                {{ $t('staff.common.edit') }}
              </UiButton>
            </div>
            <div class="flex items-center gap-3 py-2.5">
              <dt
                class="w-28 shrink-0 text-text-secondary sm:w-36"
                :title="$t('staff.events.syncHint')"
              >
                {{ $t('staff.events.sync') }}
              </dt>
              <dd class="tabular flex min-w-0 flex-1 flex-col gap-0.5">
                <template v-if="shownSite.eventsSync">
                  <span class="flex items-center gap-2 whitespace-nowrap">
                    <UiBadge :tone="shownSite.eventsSync.ok ? 'success' : 'warning'">{{
                      shownSite.eventsSync.ok
                        ? $t('staff.events.syncOk')
                        : $t('staff.events.syncFailed')
                    }}</UiBadge>
                    <span :title="formatDateTime(shownSite.eventsSync.at)">{{
                      formatRelative(shownSite.eventsSync.at)
                    }}</span>
                  </span>
                  <span class="text-xs text-text-muted">{{ syncCounts }}</span>
                  <span
                    v-for="line in [
                      ...shownSite.eventsSync.errors,
                      ...shownSite.eventsSync.unparsed,
                    ]"
                    :key="line"
                    class="truncate text-xs text-warning-text"
                    :title="line"
                    >{{ line }}</span
                  >
                </template>
                <span v-else class="text-text-muted">{{ $t('staff.events.neverSynced') }}</span>
              </dd>
              <UiButton
                v-if="canSettings"
                variant="ghost"
                size="sm"
                :loading="syncing"
                @click="syncEvents"
              >
                {{ $t('staff.events.syncNow') }}
              </UiButton>
            </div>
          </dl>
          <dl class="flex flex-col divide-y divide-border-subtle text-sm">
            <div class="flex items-center gap-3 py-2.5">
              <dt class="w-28 shrink-0 text-text-secondary sm:w-36">
                {{ $t('staff.overview.humanCheck') }}
              </dt>
              <dd>
                <UiBadge :tone="shownSite.humanCheck ? 'success' : 'neutral'">{{
                  shownSite.humanCheck ? $t('staff.common.on') : $t('staff.common.off')
                }}</UiBadge>
              </dd>
            </div>
            <div class="flex items-center gap-3 py-2.5">
              <dt class="w-28 shrink-0 text-text-secondary sm:w-36">Discord</dt>
              <dd>
                <UiBadge :tone="shownSite.providers.discord ? 'success' : 'neutral'">{{
                  shownSite.providers.discord ? $t('staff.common.on') : $t('staff.common.off')
                }}</UiBadge>
              </dd>
            </div>
            <div class="flex items-center gap-3 py-2.5">
              <dt class="w-28 shrink-0 text-text-secondary sm:w-36">Google</dt>
              <dd>
                <UiBadge :tone="shownSite.providers.google ? 'success' : 'neutral'">{{
                  shownSite.providers.google ? $t('staff.common.on') : $t('staff.common.off')
                }}</UiBadge>
              </dd>
            </div>
            <div class="flex items-center gap-3 py-2.5">
              <dt class="w-28 shrink-0 text-text-secondary sm:w-36">
                {{ $t('staff.overview.email') }}
              </dt>
              <dd>
                <UiBadge :tone="emailTone(shownSite.email)">{{
                  $t(`staff.overview.emailState.${shownSite.email}`)
                }}</UiBadge>
              </dd>
            </div>
            <div class="flex items-center gap-3 py-2.5">
              <dt class="w-28 shrink-0 text-text-secondary sm:w-36">
                {{ $t('staff.overview.build') }}
              </dt>
              <dd class="flex flex-wrap items-center gap-2">
                <span
                  v-if="shownSite.build"
                  class="font-code text-[0.8125rem]"
                  :title="shownSite.build.builtAt"
                  >{{ shownSite.build.commit.slice(0, 7) }}</span
                >
                <UiBadge
                  :tone="shownSite.migrations.pending.length ? 'warning' : 'neutral'"
                  :title="shownSite.migrations.pending.join(', ') || undefined"
                  >{{
                    shownSite.migrations.pending.length
                      ? $t('staff.overview.migrationsPending', {
                          n: shownSite.migrations.pending.length,
                        })
                      : $t('staff.overview.migrationsOk')
                  }}</UiBadge
                >
              </dd>
            </div>
            <div class="flex items-center gap-3 py-2.5">
              <dt class="w-28 shrink-0 text-text-secondary sm:w-36">
                {{ $t('staff.overview.gameData') }}
              </dt>
              <dd class="tabular" :title="gameData.version">
                v{{ gameData.version.split('+')[0] }}
              </dd>
            </div>
          </dl>
        </div>
      </UiPanel>
    </div>
  </div>

  <LimitsDialog
    :open="limitsOpen"
    :site="shownSite"
    :busy="saving"
    @close="limitsOpen = false"
    @confirm="saveLimits"
  />
  <DomainEventsDialog
    :open="eventsOpen"
    :site="shownSite"
    :busy="saving"
    @close="eventsOpen = false"
    @confirm="saveEvents"
  />
</template>
