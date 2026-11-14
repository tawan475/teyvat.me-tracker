<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Check, KeyRound, TriangleAlert } from 'lucide-vue-next'
import { API_AREAS, type ApiArea, type ApiLimits, type ApiTokenResponse } from '@gdt/shared'
import { api } from '@/api'
import CopyField from '@/components/import/CopyField.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiField from '@/components/ui/UiField.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { t } from '@/i18n'
import { formatDateTime, formatRelative } from '@/lib/format'
import { useAccounts } from '@/stores/accounts'
import { useFeedback } from '@/stores/feedback'

/**
 * Settings → API tokens (docs/plans/public-api.md §10, design B): rows like
 * Devices, the create form opening in the panel, every token reads all
 * areas of its accounts and the user picks what it may also change; the new
 * token is shown once at the top; a limits row with the tier at the foot.
 */
const feedback = useFeedback()
const accounts = useAccounts()
const tokens = ref<ApiTokenResponse[]>([])
const limits = ref<ApiLimits | null>(null)
const loaded = ref(false)
const failed = ref(false)
const creating = ref(false)
const busy = ref<string | null>(null)
const made = ref<{ name: string; secret: string } | null>(null)

const name = ref('')
const account = ref<number | 'all'>('all')
const expires = ref<'30' | '90' | '365' | 'never'>('90')
const write = ref<Set<ApiArea>>(new Set())

const accountOptions = computed(() => [
  { value: 'all' as const, label: t('settings.apiTokens.allAccounts') },
  ...accounts.list.map((a) => ({ value: a.id, label: a.name || a.uid || `#${a.id}` })),
])
const expiryOptions = computed(() => [
  { value: '30' as const, label: t('settings.apiTokens.days', { n: 30 }) },
  { value: '90' as const, label: t('settings.apiTokens.days', { n: 90 }) },
  { value: '365' as const, label: t('settings.apiTokens.days', { n: 365 }) },
  { value: 'never' as const, label: t('settings.apiTokens.never') },
])

const areaLabel = (area: ApiArea) => t(`settings.apiTokens.areas.${area}`)
const accessText = (token: ApiTokenResponse) =>
  token.write.length === 0
    ? t('settings.apiTokens.readOnly')
    : token.write.length === API_AREAS.length
      ? t('settings.apiTokens.writeAll')
      : t('settings.apiTokens.writes', { areas: token.write.map(areaLabel).join(', ') })
const accountText = (token: ApiTokenResponse) =>
  token.accounts === null
    ? t('settings.apiTokens.allAccounts')
    : token.accounts
        .map((id) => {
          const a = accounts.byId.get(id)
          return a ? a.name || a.uid || `#${id}` : `#${id}`
        })
        .join(', ')
const SOON_MS = 14 * 86_400_000

async function load() {
  try {
    const answer = await api.apiTokens()
    tokens.value = answer.tokens
    limits.value = answer.limits
    failed.value = false
  } catch {
    failed.value = true
  } finally {
    loaded.value = true
  }
}
onMounted(load)

function toggle(area: ApiArea) {
  const next = new Set(write.value)
  if (next.has(area)) next.delete(area)
  else next.add(area)
  write.value = next
}

function resetForm() {
  name.value = ''
  account.value = 'all'
  expires.value = '90'
  write.value = new Set()
}

async function create() {
  if (!name.value.trim()) return
  busy.value = 'create'
  try {
    const answer = await api.createApiToken({
      name: name.value.trim(),
      accounts: account.value === 'all' ? null : [account.value],
      expiresInDays: expires.value === 'never' ? null : (Number(expires.value) as 30 | 90 | 365),
      write: API_AREAS.filter((a) => write.value.has(a)),
    })
    made.value = { name: answer.token.name, secret: answer.secret }
    tokens.value = [answer.token, ...tokens.value]
    creating.value = false
    resetForm()
  } catch (error) {
    feedback.error(t('settings.apiTokens.notMade'), error)
  } finally {
    busy.value = null
  }
}

async function revoke(token: ApiTokenResponse) {
  const ok = await feedback.confirm({
    title: t('settings.apiTokens.revokeTitle', { name: token.name }),
    detail: t('settings.apiTokens.revokeDetail'),
    confirmLabel: t('settings.apiTokens.revoke'),
    tone: 'danger',
  })
  if (!ok) return
  busy.value = token.id
  try {
    await api.revokeApiToken(token.id)
    tokens.value = tokens.value.filter((x) => x.id !== token.id)
    feedback.toast({ tone: 'success', title: t('settings.apiTokens.revoked') })
  } catch (error) {
    feedback.error(t('settings.apiTokens.notRevoked'), error)
  } finally {
    busy.value = null
  }
}

async function revokeAll() {
  const ok = await feedback.confirm({
    title: t('settings.apiTokens.revokeAllTitle'),
    detail: t('settings.apiTokens.revokeDetail'),
    confirmLabel: t('settings.apiTokens.revokeAll'),
    tone: 'danger',
  })
  if (!ok) return
  busy.value = 'all'
  try {
    await api.revokeApiTokens()
    tokens.value = []
    made.value = null
    feedback.toast({ tone: 'success', title: t('settings.apiTokens.revoked') })
  } catch (error) {
    feedback.error(t('settings.apiTokens.notRevoked'), error)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div id="api-tokens" class="flex scroll-mt-20 flex-col gap-4">
    <div
      v-if="made"
      class="flex flex-col gap-3 rounded-xl border border-accent-text bg-surface-raised p-5 shadow-sm"
    >
      <p class="flex items-center gap-2 font-semibold">
        <Check class="size-5 text-success-text" aria-hidden="true" />
        {{ $t('settings.apiTokens.made', { name: made.name }) }}
      </p>
      <CopyField :label="$t('settings.apiTokens.token')" :value="made.secret" />
      <p
        class="flex items-start gap-2 rounded-lg border border-warning-text/35 bg-amber-500/10 p-3 text-sm text-warning-text"
      >
        <TriangleAlert class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {{ $t('settings.apiTokens.shownOnce') }}
      </p>
    </div>

    <UiPanel :title="$t('settings.apiTokens.title')" flush>
      <template #actions>
        <a class="text-sm text-accent-text hover:underline" href="/developers/api">{{
          $t('settings.apiTokens.docs')
        }}</a>
        <UiButton
          size="sm"
          :variant="creating ? 'secondary' : 'primary'"
          :aria-expanded="creating"
          @click="creating = !creating"
        >
          {{ $t('settings.apiTokens.create') }}
        </UiButton>
      </template>

      <form
        v-if="creating"
        class="flex flex-col gap-4 border-b border-border-default bg-surface-base p-5"
        @submit.prevent="create"
      >
        <div
          class="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_minmax(0,11rem)]"
        >
          <UiField v-slot="{ id }" :label="$t('settings.apiTokens.name')">
            <UiInput
              :id="id"
              v-model="name"
              maxlength="48"
              :placeholder="$t('settings.apiTokens.namePlaceholder')"
              autofocus
            />
          </UiField>
          <UiField v-slot="{ id }" :label="$t('settings.apiTokens.accounts')">
            <UiSelect :id="id" v-model="account" :options="accountOptions" />
          </UiField>
          <UiField v-slot="{ id }" :label="$t('settings.apiTokens.expires')">
            <UiSelect :id="id" v-model="expires" :options="expiryOptions" />
          </UiField>
        </div>
        <div class="flex flex-col gap-2">
          <span
            class="text-sm font-medium text-text-secondary"
            :title="$t('settings.apiTokens.writeTitle')"
            >{{ $t('settings.apiTokens.alsoChange') }}</span
          >
          <div
            class="flex flex-wrap gap-2"
            role="group"
            :aria-label="$t('settings.apiTokens.alsoChange')"
          >
            <FilterChip
              v-for="area in API_AREAS"
              :key="area"
              :pressed="write.has(area)"
              @toggle="toggle(area)"
            >
              {{ areaLabel(area) }}
            </FilterChip>
          </div>
          <span class="text-sm text-text-muted">{{
            write.size === 0
              ? $t('settings.apiTokens.readOnly')
              : $t('settings.apiTokens.writes', {
                  areas: API_AREAS.filter((a) => write.has(a))
                    .map(areaLabel)
                    .join(', '),
                })
          }}</span>
        </div>
        <div class="flex justify-end gap-2">
          <UiButton size="sm" variant="ghost" type="button" @click="creating = false">{{
            $t('common.cancel')
          }}</UiButton>
          <UiButton
            size="sm"
            variant="primary"
            type="submit"
            :disabled="!name.trim()"
            :loading="busy === 'create'"
          >
            {{ $t('settings.apiTokens.createShort') }}
          </UiButton>
        </div>
      </form>

      <p v-if="loaded && failed" class="p-5 text-sm text-text-muted">
        {{ $t('settings.apiTokens.notLoaded') }}
      </p>
      <p v-else-if="loaded && tokens.length === 0 && !creating" class="p-5 text-sm text-text-muted">
        {{ $t('settings.apiTokens.none') }}
      </p>
      <ul v-else>
        <li
          v-for="token in tokens"
          :key="token.id"
          class="flex items-center gap-3.5 border-b border-border-subtle px-5 py-3.5 last:border-b-0"
        >
          <span
            class="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-overlay text-text-secondary"
            aria-hidden="true"
          >
            <KeyRound class="size-5" />
          </span>
          <div class="flex min-w-0 flex-1 flex-col gap-0.5">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="truncate font-medium">{{ token.name }}</span>
              <UiBadge :tone="token.write.length ? 'accent' : 'neutral'">{{
                accessText(token)
              }}</UiBadge>
            </div>
            <div class="truncate text-sm text-text-muted">
              {{ accountText(token) }} ·
              <span :title="token.lastUsedAt ? formatDateTime(token.lastUsedAt) : undefined">{{
                token.lastUsedAt
                  ? $t('settings.apiTokens.used', { when: formatRelative(token.lastUsedAt) })
                  : $t('settings.apiTokens.neverUsed')
              }}</span>
              <template v-if="token.lastCountry"> · {{ token.lastCountry }}</template>
              ·
              <span
                v-if="token.expiresAt"
                :class="token.expiresAt - Date.now() < SOON_MS ? 'text-warning-text' : ''"
                :title="formatDateTime(token.expiresAt)"
                >{{
                  $t('settings.apiTokens.expiresIn', { when: formatRelative(token.expiresAt) })
                }}</span
              >
              <span v-else>{{ $t('settings.apiTokens.noExpiry') }}</span>
            </div>
          </div>
          <UiButton size="sm" variant="ghost" :loading="busy === token.id" @click="revoke(token)">
            {{ $t('settings.apiTokens.revoke') }}
          </UiButton>
        </li>
      </ul>

      <div
        v-if="limits"
        class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-b-xl border-t border-border-default bg-surface-base px-5 py-3.5"
      >
        <div class="flex min-w-0 flex-[1_1_18rem] flex-col gap-0.5">
          <span class="flex items-center gap-2 text-sm font-semibold"
            >{{ $t('settings.apiTokens.limits') }}
            <UiBadge :tone="limits.tier === 'supporter' ? 'warning' : 'neutral'">{{
              $t(`settings.apiTokens.tier.${limits.tier}`)
            }}</UiBadge></span
          >
          <span
            class="text-sm text-text-secondary tabular-nums"
            :title="$t('settings.apiTokens.limitsTitle')"
            >{{ $t('settings.apiTokens.limitsLine', { n: limits.global }) }}</span
          >
        </div>
        <a class="text-sm text-accent-text hover:underline" href="/developers/api#rate-limits">{{
          $t('settings.apiTokens.seeLimits')
        }}</a>
        <a
          v-if="limits.tier === 'free'"
          class="inline-flex items-center gap-1.5 text-sm text-accent-text hover:underline"
          href="/developers/api#supporter"
          :title="$t('settings.apiTokens.supporterTitle')"
          ><span class="text-paimon" aria-hidden="true">✦</span
          >{{ $t('settings.apiTokens.supporter') }}</a
        >
        <UiButton
          v-if="tokens.length > 1"
          size="sm"
          variant="ghost"
          class="text-danger-text"
          :loading="busy === 'all'"
          @click="revokeAll"
        >
          {{ $t('settings.apiTokens.revokeAll') }}
        </UiButton>
      </div>
    </UiPanel>
  </div>
</template>
