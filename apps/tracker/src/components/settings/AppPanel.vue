<script setup lang="ts">
import { ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { ArrowRight, CircleCheck, Download, Share, SquarePlus } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import { t } from '@/i18n'
import { installPrompt, isStandalone } from '@/pwa/register'
import { useFeedback } from '@/stores/feedback'
import BuildInfo from './BuildInfo.vue'

/**
 * Installing the PWA, and what build the server runs.
 *
 * Chromium offers a one-shot install prompt (captured in pwa/register.ts);
 * iOS Safari never does, so it gets the Share → Add to Home Screen steps.
 */
const feedback = useFeedback()

const standalone = isStandalone()
const installedNow = ref(false)
const installing = ref(false)

const ua = navigator.userAgent
const ios =
  /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)

useEventListener(window, 'appinstalled', () => (installedNow.value = true))

type InstallEvent = {
  prompt: () => Promise<unknown>
  userChoice?: Promise<{ outcome?: string }>
}

async function install() {
  const event = installPrompt.value as InstallEvent | null
  if (!event) return
  installing.value = true
  try {
    const result = (await event.prompt()) as { outcome?: string } | undefined
    const outcome = result?.outcome ?? (await event.userChoice)?.outcome
    if (outcome === 'accepted') installedNow.value = true
  } catch (error) {
    feedback.error(t('settings.app.installFailed'), error)
  } finally {
    // The browser lets each prompt event be used once.
    installPrompt.value = null
    installing.value = false
  }
}
</script>

<template>
  <UiPanel>
    <div class="flex flex-wrap gap-x-10 gap-y-6">
      <div class="min-w-0 flex-[1_1_14rem]">
        <h3 class="font-display text-lg font-bold">{{ $t('settings.app.install') }}</h3>

        <p v-if="standalone" class="mt-3 flex items-center gap-2 text-success-text">
          <CircleCheck class="size-5 shrink-0" aria-hidden="true" />
          {{ $t('settings.app.installed') }}
        </p>
        <p v-else-if="installedNow" class="mt-3 flex items-center gap-2 text-success-text">
          <CircleCheck class="size-5 shrink-0" aria-hidden="true" />
          {{ $t('settings.app.installed') }}
        </p>
        <div v-else-if="installPrompt" class="mt-3">
          <UiButton :loading="installing" @click="install">
            <Download v-if="!installing" class="size-4" aria-hidden="true" />
            {{ $t('settings.app.installApp') }}
          </UiButton>
        </div>
        <ol v-else-if="ios" class="mt-3 flex flex-col gap-2 text-text-secondary">
          <li class="flex gap-3">
            <span class="tabular font-mono text-sm leading-6 text-text-muted">1</span>
            <i18n-t keypath="settings.app.iosShare" tag="span">
              <template #icon>
                <Share
                  class="inline size-5 align-text-bottom text-text-primary"
                  aria-hidden="true"
                />
              </template>
              <template #share>
                <span class="font-medium text-text-primary">{{
                  $t('settings.app.iosShareLabel')
                }}</span>
              </template>
            </i18n-t>
          </li>
          <li class="flex gap-3">
            <span class="tabular font-mono text-sm leading-6 text-text-muted">2</span>
            <i18n-t keypath="settings.app.iosAdd" tag="span">
              <template #icon>
                <SquarePlus
                  class="inline size-5 align-text-bottom text-text-primary"
                  aria-hidden="true"
                />
              </template>
              <template #add>
                <span class="font-medium text-text-primary">{{
                  $t('settings.app.iosAddLabel')
                }}</span>
              </template>
            </i18n-t>
          </li>
        </ol>
        <p v-else class="mt-3 text-sm text-text-muted" :title="$t('settings.app.browserTitle')">
          {{ $t('settings.app.browser') }}
        </p>
      </div>

      <div class="min-w-0 flex-[999_1_30rem]">
        <BuildInfo />
      </div>
    </div>
    <div
      class="mt-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border-default pt-4"
    >
      <span class="text-text-secondary">{{ $t('shell.page.privacy') }}</span>
      <UiButton size="sm" :to="{ name: 'privacy' }"
        >{{ $t('settings.app.privacyOpen') }}<ArrowRight class="size-4" aria-hidden="true"
      /></UiButton>
    </div>
  </UiPanel>
</template>
