<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiStat from '@/components/ui/UiStat.vue'
import { ArrowRight, Monitor } from 'lucide-vue-next'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import {
  convertGuest,
  guestSummary,
  rememberConvertAnswer,
  type ConvertProgress,
  type GuestSummary,
} from '@/local/convert'
import { useAccounts } from '@/stores/accounts'
import { useFeedback } from '@/stores/feedback'

/**
 * Asked once, on Home, when this browser holds guest data (docs/plans/
 * open-site.md §4): bring it into the account? Into the account with the
 * guest's UID when there is one, else a new account. The answer is kept per
 * browser (local/convert.ts); a run that fails is asked again next time.
 */
const accounts = useAccounts()
const router = useRouter()
const feedback = useFeedback()
const summary = shallowRef<GuestSummary | null>(null)
const open = ref(false)
const running = ref(false)
const progress = shallowRef<ConvertProgress | null>(null)

onMounted(async () => {
  try {
    const found = await guestSummary()
    if (found.snapshots === 0 && found.pulls === 0) return
    summary.value = found
    open.value = true
  } catch {
    // The guest store can't be read here: nothing to offer.
  }
})

/** The account with the guest's UID, if the user has one. */
const target = computed(() => {
  const uid = summary.value?.uid
  return uid ? (accounts.list.find((a) => a.uid === uid && a.access !== 'viewer') ?? null) : null
})

/** The three counts the dialog shows as tiles (the user's pick 1A, 2026-11-08). */
const tiles = computed(() => {
  const s = summary.value
  if (!s) return []
  return [
    { key: 'snapshots', value: s.snapshots },
    { key: 'wishes', value: s.pulls },
    { key: 'goals', value: s.goals },
  ]
})

function no() {
  rememberConvertAnswer('no')
  open.value = false
}

async function yes() {
  const s = summary.value
  if (!s || running.value) return
  running.value = true
  try {
    const id =
      target.value?.id ??
      (await accounts.create({ name: s.name, uid: s.uid, server: null })).account.id
    const result = await convertGuest(id, (p) => (progress.value = p))
    await accounts.reload(id).catch(() => undefined)
    if (result.snapshots.failed === 0) rememberConvertAnswer('yes')
    open.value = false
    feedback.toast({
      tone: result.snapshots.failed === 0 ? 'success' : 'info',
      title: t('guest.convert.done'),
      detail: [
        t(
          'guest.convert.snapshots',
          { n: formatNumber(result.snapshots.created + result.snapshots.unchanged) },
          result.snapshots.created + result.snapshots.unchanged,
        ),
        ...(result.snapshots.failed > 0
          ? [t('guest.convert.failed', { n: formatNumber(result.snapshots.failed) })]
          : []),
      ].join(' · '),
    })
    await router.push({ name: 'account-overview', params: { accountId: id } })
  } catch (error) {
    feedback.error(t('guest.convert.notDone'), error)
  } finally {
    running.value = false
  }
}

const percent = computed(() => {
  const p = progress.value
  return p && p.total > 0 ? p.done : 0
})
</script>

<template>
  <UiModal sheet :open="open" :title="$t('guest.convert.title')" @close="running || no()">
    <div class="flex flex-col gap-4">
      <p class="flex items-center gap-2 text-text-secondary">
        <Monitor class="size-[1.125rem] shrink-0" aria-hidden="true" />
        {{ $t('guest.convert.body') }}
      </p>
      <div class="grid grid-cols-3 gap-2.5">
        <UiStat
          v-for="tile in tiles"
          :key="tile.key"
          :label="$t(`guest.convert.tiles.${tile.key}`)"
          :value="tile.value"
          exact
        />
      </div>
      <p
        class="flex min-w-0 items-center gap-2.5 rounded-xl bg-surface-overlay px-3 py-2.5 text-sm text-text-secondary"
      >
        <ArrowRight class="size-[1.125rem] shrink-0" aria-hidden="true" />
        <span class="min-w-0 truncate">
          <template v-if="target">
            {{ $t('guest.convert.intoLabel') }}
            <b class="font-semibold text-text-primary">{{ accounts.displayName(target) }}</b>
            <span v-if="target.uid" class="tabular"> · UID {{ target.uid }}</span>
          </template>
          <template v-else>{{ $t('guest.convert.intoNew') }}</template>
        </span>
      </p>
      <UiProgress
        v-if="running && progress"
        :value="percent"
        :max="progress.total || 1"
        :label="$t(`guest.convert.step.${progress.step}`)"
      />
    </div>
    <template #footer>
      <UiButton :disabled="running" @click="no">{{ $t('guest.convert.no') }}</UiButton>
      <UiButton variant="primary" :loading="running" @click="yes">{{
        $t('guest.convert.yes')
      }}</UiButton>
    </template>
  </UiModal>
</template>
