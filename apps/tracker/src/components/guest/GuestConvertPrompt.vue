<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import UiButton from '@/components/ui/UiButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
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

const holds = computed(() => {
  const s = summary.value
  if (!s) return ''
  const parts = [t('guest.convert.snapshots', { n: formatNumber(s.snapshots) }, s.snapshots)]
  if (s.pulls > 0) parts.push(t('guest.convert.wishes', { n: formatNumber(s.pulls) }, s.pulls))
  return parts.join(' · ')
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
  <UiModal :open="open" :title="$t('guest.convert.title')" @close="running || no()">
    <div class="flex flex-col gap-3">
      <p class="text-text-secondary">{{ $t('guest.convert.body') }}</p>
      <p class="tabular font-mono text-sm text-text-primary">{{ holds }}</p>
      <p class="text-sm text-text-secondary">
        {{
          target
            ? $t('guest.convert.into', { name: accounts.displayName(target) })
            : $t('guest.convert.intoNew')
        }}
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
