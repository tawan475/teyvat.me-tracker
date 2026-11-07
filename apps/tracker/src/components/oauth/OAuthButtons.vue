<script setup lang="ts">
import type { OAuthProvider } from '@gdt/shared'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Monitor } from 'lucide-vue-next'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import { api } from '@/api'
import { t } from '@/i18n'
import { errorText } from '@/i18n/api-errors'
import ProviderMark from './ProviderMark.vue'
import { loadSignInOptions, providerLabel, providerNames } from './oauth'

/**
 * "Continue with Discord / Google" on the sign-in and sign-up cards: only the
 * providers the server has, so nothing shows until their secrets are set.
 * `nudge` (sign-in): while the email features are paused, a line points
 * whoever can't sign in at these instead of "forgot password".
 * `guest`: a third way in under them, guest mode (the user's pick 2C,
 * 2026-11-08); `noProviders` hides the providers but keeps it (sign-ups closed).
 */
const props = defineProps<{
  next?: string
  nudge?: boolean
  guest?: boolean
  noProviders?: boolean
}>()

const providers = ref<OAuthProvider[]>([])
const emailFeatures = ref(true)
const showNudge = computed(() => props.nudge && !emailFeatures.value)
const shown = computed<OAuthProvider[]>(() => (props.noProviders ? [] : providers.value))
const busy = ref<OAuthProvider | null>(null)
const error = ref('')

/** Back from the provider with the browser's Back button: the page may be restored as it was left. */
function onPageShow(event: PageTransitionEvent) {
  if (event.persisted) busy.value = null
}

onMounted(async () => {
  window.addEventListener('pageshow', onPageShow)
  const options = await loadSignInOptions()
  providers.value = options.providers
  emailFeatures.value = options.emailFeatures
})
onBeforeUnmount(() => window.removeEventListener('pageshow', onPageShow))

async function go(provider: OAuthProvider) {
  error.value = ''
  busy.value = provider
  try {
    const { url } = await api.oauthStart(provider, props.next)
    window.location.assign(url)
  } catch (cause) {
    busy.value = null
    error.value = errorText(cause, t('auth.oauth.couldNotStart'))
  }
}
</script>

<template>
  <div v-if="shown.length || guest" class="mt-6 flex flex-col gap-4">
    <div class="flex items-center gap-3 text-sm text-gray-400">
      <span class="h-px flex-1 bg-white/10" />
      {{ $t('common.or') }}
      <span class="h-px flex-1 bg-white/10" />
    </div>
    <div
      v-if="shown.length"
      class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2.5"
    >
      <button
        v-for="provider in shown"
        :key="provider"
        type="button"
        class="btn-glass min-w-0 px-3"
        :disabled="busy !== null"
        :aria-label="$t('auth.oauth.continueWith', { provider: providerLabel(provider) })"
        :title="$t('auth.oauth.continueWith', { provider: providerLabel(provider) })"
        @click="go(provider)"
      >
        <UiSpinner v-if="busy === provider" class="size-5 shrink-0" />
        <ProviderMark v-else :provider="provider" class="size-5 shrink-0" />
        <span class="truncate">{{ providerLabel(provider) }}</span>
      </button>
    </div>
    <RouterLink
      v-if="guest"
      :to="{ name: 'guest-overview' }"
      class="btn-glass guest-way min-w-0 px-3"
      :title="$t('guest.tryHint')"
    >
      <Monitor class="size-5 shrink-0" aria-hidden="true" />
      <span class="truncate">{{ $t('guest.try') }}</span>
    </RouterLink>
    <p
      v-if="showNudge && shown.length"
      class="text-center text-sm text-gray-400"
      :title="$t('auth.oauth.cantSignInTitle')"
    >
      {{ $t('auth.oauth.cantSignIn', { providers: providerNames(providers) }) }}
    </p>
    <p v-if="error" class="text-sm text-red-300" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
/* The guest way in reads as a different kind of door: a dashed indigo edge. */
.guest-way {
  text-decoration: none;
  box-shadow: none;
  outline: 1px dashed rgba(165, 180, 252, 0.6);
  outline-offset: -1px;
  color: #e0e7ff;
}
</style>
