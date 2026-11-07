<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { KeyRound, X } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { api } from '@/api'
import { loadSignInOptions } from '@/components/oauth/oauth'
import { t } from '@/i18n'
import { createPasskey, platformPasskeyAvailable } from '@/lib/passkeys'
import { dismissedNudge, nudgeDue, shownNudge } from '@/lib/passkey-nudge'
import { markPasskeyMade, readNudge, saveNudge } from '@/lib/passkey-nudge-store'
import { useFeedback } from '@/stores/feedback'
import { passkeyCause } from './passkeys'

/**
 * Home's passkey reminder, both of the user's picks: the slim card at the
 * top of the page (design A) and the corner toast (design B), which pops up
 * with it and fades after TOAST_MS (its × only closes the toast). Only on a
 * device that can make a passkey, for an account with none, and as rarely as
 * lib/passkey-nudge allows. Set up makes one here; Not now on either puts
 * both off.
 */
const TOAST_MS = 12_000

const open = ref(false)
const toast = ref(false)
const busy = ref(false)
const feedback = useFeedback()
let timer: ReturnType<typeof setTimeout> | undefined

onMounted(async () => {
  if (!nudgeDue(readNudge())) return
  const [options, device, rows] = await Promise.all([
    loadSignInOptions(),
    platformPasskeyAvailable(),
    api.passkeys().catch(() => null),
  ])
  if (!options.passkeys || !device || !rows || rows.length > 0) return
  saveNudge(shownNudge(readNudge()))
  open.value = true
  toast.value = true
  timer = setTimeout(() => (toast.value = false), TOAST_MS)
})

onBeforeUnmount(() => clearTimeout(timer))

function close() {
  open.value = false
  toast.value = false
  clearTimeout(timer)
}

function later() {
  saveNudge(dismissedNudge(readNudge()))
  close()
}

async function setUp() {
  busy.value = true
  try {
    if (!(await createPasskey())) return
    markPasskeyMade()
    close()
    feedback.toast({ tone: 'success', title: t('settings.passkeys.added') })
  } catch (cause) {
    feedback.error(t('settings.passkeys.notAdded'), passkeyCause(cause))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section
    v-if="open"
    class="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-border-default bg-surface-raised px-4 py-3.5 shadow-sm"
    :aria-label="$t('settings.passkeys.nudgeTitle')"
  >
    <span
      class="grid size-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text"
      aria-hidden="true"
    >
      <KeyRound class="size-5" />
    </span>
    <div class="min-w-0 flex-[1_1_12rem]" :title="$t('settings.passkeys.addTitle')">
      <p class="font-medium">{{ $t('settings.passkeys.nudgeTitle') }}</p>
      <p class="text-sm text-text-muted">{{ $t('settings.passkeys.nudgeText') }}</p>
    </div>
    <div class="flex gap-2">
      <UiButton size="sm" variant="ghost" :disabled="busy" @click="later">
        {{ $t('settings.passkeys.notNow') }}
      </UiButton>
      <UiButton size="sm" variant="primary" :loading="busy" @click="setUp">
        {{ $t('settings.passkeys.setUp') }}
      </UiButton>
    </div>
  </section>

  <Transition
    enter-from-class="translate-y-2 opacity-0"
    enter-active-class="transition duration-200 motion-reduce:transition-none"
    leave-to-class="opacity-0"
    leave-active-class="transition duration-300 motion-reduce:transition-none"
  >
    <aside
      v-if="open && toast"
      class="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex items-start gap-3 rounded-xl border border-border-default bg-surface-raised p-3.5 pl-4 shadow-overlay sm:left-auto sm:w-[23rem] lg:right-6 lg:bottom-6"
      role="status"
    >
      <span
        class="grid size-10 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text"
        aria-hidden="true"
      >
        <KeyRound class="size-5" />
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-2.5">
        <div>
          <p class="font-medium">{{ $t('settings.passkeys.nudgeTitle') }}</p>
          <p class="text-sm text-text-muted">{{ $t('settings.passkeys.nudgeText') }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <UiButton size="sm" variant="primary" :loading="busy" @click="setUp">
            {{ $t('settings.passkeys.setUp') }}
          </UiButton>
          <UiButton size="sm" variant="ghost" :disabled="busy" @click="later">
            {{ $t('settings.passkeys.notNow') }}
          </UiButton>
        </div>
      </div>
      <UiIconButton
        :label="$t('common.close')"
        class="-mt-1.5 -mr-1.5 size-8"
        @click="toast = false"
      >
        <X class="size-4" aria-hidden="true" />
      </UiIconButton>
    </aside>
  </Transition>
</template>
