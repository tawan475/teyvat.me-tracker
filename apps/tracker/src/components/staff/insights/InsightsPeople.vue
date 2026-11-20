<script setup lang="ts">
import { COUNTRY_BASES, type CountryBasis, type CountryRow } from '@gdt/shared'
import { TriangleAlert } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import StatList, { type StatRow } from '@/components/staff/StatList.vue'
import { share } from '@/components/staff/metrics/series'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiError from '@/components/ui/UiError.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { api } from '@/api'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { LANGUAGE_NAMES } from '@/i18n/language-names'
import { formatDate, formatNumber } from '@/lib/format'
import { regionName } from '@/lib/region-name'
import { useSession } from '@/stores/session'

/**
 * People: where users are (by where they signed up from, or their newest
 * session), how they sign in, which language and theme they use, which game
 * servers their accounts are on, and which client programs and versions are
 * out there. Totals only; a country opens the Users page filtered to it for
 * staff who may see users.
 */
const props = defineProps<{ refresh: number }>()
const emit = defineEmits<{ loaded: [at: number] }>()
const session = useSession()

const basis = ref<CountryBasis>('signup')
const { data, error, reload } = useResource(
  () => ({ basis: basis.value, refresh: props.refresh }),
  ({ basis }) => api.staff.insightsPeople(basis),
)
watch(data, (value) => value && emit('loaded', value.at))

const bases = computed(() =>
  COUNTRY_BASES.map((value) => ({ value, label: t(`staff.insights.people.bases.${value}`) })),
)

/** How many countries get a row of their own; the rest are summed. */
const TOP = 12
const countries = computed(() => {
  const all = data.value?.countries ?? []
  const known = all.filter((c) => c.code)
  const top = known.slice(0, TOP)
  const rest = [...known.slice(TOP), ...all.filter((c) => !c.code)]
  const rows: (CountryRow & { name: string; link: boolean })[] = top.map((c) => ({
    ...c,
    name: regionName(c.code!),
    link: basis.value === 'signup' && session.can('users.view'),
  }))
  if (rest.length) {
    const sum = (key: keyof Omit<CountryRow, 'code'>) => rest.reduce((n, c) => n + c[key], 0)
    rows.push({
      code: null,
      users: sum('users'),
      active7d: sum('active7d'),
      new30d: sum('new30d'),
      withClient: sum('withClient'),
      uploading: sum('uploading'),
      name: t('staff.insights.people.otherCountries', {
        n: formatNumber(known.length - top.length),
      }),
      link: false,
    })
  }
  return rows
})
const mostUsers = computed(() => Math.max(1, ...countries.value.map((c) => c.users)))

const noted = (key: string, n: number, of: number, title?: string): StatRow => ({
  key,
  label: t(`staff.insights.people.${key}`),
  value: formatNumber(n),
  note: share(n, of),
  title,
})
const ways = computed<StatRow[]>(() => {
  const d = data.value
  if (!d) return []
  const w = d.ways
  return [
    noted('password', w.password, d.users),
    { ...noted('password', w.discord, d.users), key: 'discord', label: 'Discord' },
    { ...noted('password', w.google, d.users), key: 'google', label: 'Google' },
    noted(
      'passkey',
      w.passkey,
      d.users,
      t('staff.insights.people.passkeyTitle', { n: formatNumber(w.passkeys) }),
    ),
    noted('noPassword', w.noPassword, d.users, t('staff.insights.people.noPasswordTitle')),
    noted('oneWay', w.oneWay, d.users, t('staff.insights.people.oneWayTitle')),
    noted('suspended', w.suspended, d.users),
    noted('uploadsBlocked', w.uploadsBlocked, d.users),
  ]
})

/** The most used first, the long tail summed. */
function topOf(list: { key: string; users: number }[], keep: number, name: (key: string) => string) {
  const d = data.value
  const rows: StatRow[] = list.slice(0, keep).map((row) => ({
    key: row.key,
    label: name(row.key),
    value: formatNumber(row.users),
    note: share(row.users, d?.users ?? 0),
  }))
  const rest = list.slice(keep)
  if (rest.length) {
    const users = rest.reduce((n, row) => n + row.users, 0)
    rows.push({
      key: 'other',
      label: t('staff.insights.people.otherCount', { n: formatNumber(rest.length) }),
      value: formatNumber(users),
      note: share(users, d?.users ?? 0),
    })
  }
  return rows
}
const languages = computed(() =>
  topOf(data.value?.languages ?? [], 6, (key) =>
    key === 'system'
      ? t('staff.insights.people.followsBrowser')
      : (LANGUAGE_NAMES[key as keyof typeof LANGUAGE_NAMES] ?? key),
  ),
)
const themes = computed(() =>
  topOf(data.value?.themes ?? [], 3, (key) =>
    ['system', 'light', 'dark'].includes(key) ? t(`staff.insights.people.themes.${key}`) : key,
  ),
)
const servers = computed<StatRow[]>(() =>
  (data.value?.servers ?? []).map((row) => ({
    key: row.key ?? 'none',
    label: row.key ?? t('staff.insights.people.noServer'),
    value: formatNumber(row.accounts),
    note: share(row.accounts, data.value?.accounts ?? 0),
  })),
)

const mostDevices = computed(() => Math.max(1, ...(data.value?.clients ?? []).map((c) => c.devices)))
const oldDevices = computed(() =>
  (data.value?.clients ?? []).filter((c) => c.old).reduce((n, c) => n + c.devices, 0),
)
</script>

<template>
  <UiError
    v-if="error && !data"
    :error="error"
    :title="$t('staff.common.couldNotLoad')"
    @retry="reload"
  />
  <div v-else-if="!data" class="flex flex-col gap-6" aria-busy="true">
    <UiSkeleton class="h-80" />
    <UiSkeleton class="h-48" />
  </div>

  <template v-else>
    <UiPanel :title="$t('staff.insights.people.countries')" flush>
      <template #actions>
        <UiSegmented
          v-model="basis"
          :options="bases"
          :label="$t('staff.insights.people.basisLabel')"
        />
      </template>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[46rem] text-sm">
          <thead
            class="border-b border-border-default bg-surface-overlay/50 text-text-secondary [&_th]:whitespace-nowrap"
          >
            <tr>
              <th scope="col" class="px-3 py-2 text-left font-medium">
                {{ $t('staff.insights.people.country') }}
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.overview.users') }}
              </th>
              <th scope="col" class="w-[26%] px-3 py-2">
                <span class="sr-only">{{ $t('staff.insights.share') }}</span>
              </th>
              <th
                v-for="column in ['active7d', 'new30d', 'withClient', 'uploading']"
                :key="column"
                scope="col"
                class="px-3 py-2 text-right font-medium"
                :title="$t(`staff.insights.people.${column}Title`)"
              >
                {{ $t(`staff.insights.people.${column}`) }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border-subtle [&_td]:whitespace-nowrap">
            <tr
              v-for="row in countries"
              :key="row.code ?? 'other'"
              class="hover:bg-surface-overlay/60"
            >
              <td class="px-3 py-2">
                <component
                  :is="row.link ? 'RouterLink' : 'span'"
                  :to="row.link ? { name: 'staff-users', query: { country: row.code } } : undefined"
                  class="inline-flex min-w-0 items-center gap-2"
                  :class="row.link ? 'hover:text-accent-text' : ''"
                  :title="row.link ? $t('staff.insights.people.openUsers') : undefined"
                >
                  <UiBadge v-if="row.code" mono>{{ row.code }}</UiBadge>
                  <span class="truncate font-medium">{{ row.name }}</span>
                </component>
              </td>
              <td class="tabular px-3 py-2 text-right font-mono">{{ formatNumber(row.users) }}</td>
              <td class="px-3 py-2">
                <span class="flex items-center gap-2">
                  <UiProgress
                    class="flex-1"
                    :value="row.users"
                    :max="mostUsers"
                    :label="row.name"
                  />
                  <span class="tabular w-12 text-right font-mono text-text-muted">{{
                    share(row.users, data.users)
                  }}</span>
                </span>
              </td>
              <td class="tabular px-3 py-2 text-right font-mono">
                {{ formatNumber(row.active7d) }}
              </td>
              <td class="tabular px-3 py-2 text-right font-mono">{{ formatNumber(row.new30d) }}</td>
              <td class="tabular px-3 py-2 text-right font-mono">
                {{ formatNumber(row.withClient) }}
              </td>
              <td class="tabular px-3 py-2 text-right font-mono">
                {{ formatNumber(row.uploading) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiPanel>

    <div class="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3">
      <UiPanel :title="$t('staff.insights.people.ways')">
        <StatList :rows="ways" />
      </UiPanel>
      <UiPanel :title="$t('staff.insights.people.languageTheme')">
        <StatList :rows="languages" />
        <div class="my-4 h-px bg-border-default" />
        <StatList :rows="themes" />
      </UiPanel>
      <UiPanel :title="$t('staff.insights.people.servers')">
        <StatList :rows="servers" />
      </UiPanel>
    </div>

    <UiPanel :title="$t('staff.insights.people.clients')" flush>
      <template v-if="oldDevices" #actions>
        <UiBadge tone="warning" :title="$t('staff.insights.people.oldTitle')">
          <TriangleAlert class="size-3" aria-hidden="true" />
          {{ $t('staff.insights.people.oldCount', { n: formatNumber(oldDevices) }) }}
        </UiBadge>
      </template>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[40rem] text-sm">
          <thead
            class="border-b border-border-default bg-surface-overlay/50 text-text-secondary [&_th]:whitespace-nowrap"
          >
            <tr>
              <th scope="col" class="px-3 py-2 text-left font-medium">
                {{ $t('staff.metrics.online.program') }}
              </th>
              <th scope="col" class="px-3 py-2 text-left font-medium">
                {{ $t('staff.metrics.online.version') }}
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.insights.people.devices') }}
              </th>
              <th scope="col" class="w-[28%] px-3 py-2">
                <span class="sr-only">{{ $t('staff.insights.share') }}</span>
              </th>
              <th scope="col" class="px-3 py-2 text-right font-medium">
                {{ $t('staff.metrics.activity.seen24') }}
              </th>
              <th
                scope="col"
                class="px-3 py-2 text-right font-medium"
                :title="$t('staff.insights.people.firstSeenTitle')"
              >
                {{ $t('staff.insights.people.firstSeen') }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border-subtle [&_td]:whitespace-nowrap">
            <tr
              v-for="row in data.clients"
              :key="`${row.program} ${row.version}`"
              class="hover:bg-surface-overlay/60"
            >
              <td class="px-3 py-2 font-code text-[0.8125rem]">{{ row.program }}</td>
              <td class="px-3 py-2">
                <span v-if="row.version" class="inline-flex items-center gap-1.5">
                  <span class="font-code text-[0.8125rem]">{{ row.version }}</span>
                  <UiBadge v-if="row.old" tone="warning">{{
                    $t('staff.insights.people.old')
                  }}</UiBadge>
                </span>
                <span
                  v-else
                  class="text-text-muted"
                  :title="$t('staff.insights.people.noVersionTitle')"
                  >{{ $t('staff.insights.people.noVersion') }}</span
                >
              </td>
              <td class="tabular px-3 py-2 text-right font-mono">
                {{ formatNumber(row.devices) }}
              </td>
              <td class="px-3 py-2">
                <UiProgress :value="row.devices" :max="mostDevices" :label="row.program" />
              </td>
              <td class="tabular px-3 py-2 text-right font-mono">
                {{ formatNumber(row.seen24h) }}
              </td>
              <td class="tabular px-3 py-2 text-right font-mono">
                {{ row.firstSeenAt ? formatDate(row.firstSeenAt) : '—' }}
              </td>
            </tr>
            <tr v-if="data.clients.length === 0">
              <td colspan="6" class="px-3 py-6 text-center text-text-muted">
                {{ $t('staff.insights.people.noClients') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UiPanel>
  </template>
</template>
