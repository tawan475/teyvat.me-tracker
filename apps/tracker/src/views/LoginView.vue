<script setup lang="ts">
import { appPath } from '@gdt/shared'
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import HumanCheck from '@/components/auth/HumanCheck.vue'
import { humanCheckNeeded, humanCheckPassed, siteKeyAfter } from '@/components/auth/human-check'
import OAuthButtons from '@/components/oauth/OAuthButtons.vue'
import ProviderMark from '@/components/oauth/ProviderMark.vue'
import {
  isProvider,
  loadSignInOptions,
  oauthErrorText,
  providerLabel,
} from '@/components/oauth/oauth'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import { ApiRequestError } from '@/api'
import { t } from '@/i18n'
import { errorText } from '@/i18n/api-errors'
import { useSession } from '@/stores/session'
import AuthFrame from './AuthFrame.vue'

const session = useSession()
const router = useRouter()
const route = useRoute()

const login = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
/** "Forgot password?" only while the email features are on (else the nudge under the form). */
const emailFeatures = ref(false)
/** The human check's site key while the server has it on (null: off; undefined: not asked yet). */
const siteKey = ref<string | null | undefined>(undefined)
const human = useTemplateRef<InstanceType<typeof HumanCheck>>('human')
/** HumanCheck holds a fresh token. */
const humanReady = ref(false)
const humanOk = computed(() => humanCheckPassed(siteKey.value, humanReady.value))

/** Where to go after signing in: a page of the app, or irminsul's /link (the server checks it the same way). */
const next = computed(() =>
  appPath.safeParse(route.query.next).success ? (route.query.next as string) : undefined,
)

/** `?link=discord`: from "I have an account" on /oauth; signing in also links that account. */
const linking = computed(() => (isProvider(route.query.link) ? route.query.link : null))

onMounted(async () => {
  // Back from Discord / Google with a problem: say it once, then drop it from the URL.
  const code = route.query.oauth_error
  if (typeof code === 'string') {
    error.value = oauthErrorText(code)
    void router.replace({ query: { ...route.query, oauth_error: undefined } })
  }
  const options = await loadSignInOptions()
  emailFeatures.value = options.emailFeatures
  siteKey.value = options.turnstileSiteKey
})

async function submit() {
  error.value = ''
  busy.value = true
  try {
    const turnstile = siteKey.value ? await human.value?.token() : undefined
    if (linking.value) {
      const result = await session.oauthLinkLogin(login.value.trim(), password.value, turnstile)
      // Linked, or why not: Settings says which and can link it again.
      await router.replace({
        name: 'settings',
        query: result.linked ? { linked: result.linked } : { oauth_error: result.problem },
      })
      return
    }
    await session.login(login.value.trim(), password.value, turnstile)
    await router.replace(next.value ?? '/app')
  } catch (cause) {
    const key = await siteKeyAfter(cause)
    if (key) siteKey.value = key
    error.value = key
      ? humanCheckNeeded()
      : cause instanceof ApiRequestError && cause.code === 'invalid_credentials'
        ? t('auth.wrongCredentials')
        : errorText(cause, t('auth.signInFailed'))
  } finally {
    // A token works once, whatever the answer.
    human.value?.reset()
    busy.value = false
  }
}
</script>

<template>
  <AuthFrame :title="$t('auth.welcomeBack')" :subtitle="linking ? undefined : $t('auth.signInSub')">
    <p
      v-if="linking"
      class="mb-4 flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-gray-200"
    >
      <ProviderMark :provider="linking" class="size-5 shrink-0" />
      {{ $t('auth.signInToLink', { provider: providerLabel(linking) }) }}
    </p>
    <p
      v-if="error"
      class="mb-4 rounded-lg border border-red-500/50 bg-red-500/20 p-3 text-sm text-red-300"
      role="alert"
    >
      {{ error }}
    </p>
    <form class="flex flex-col gap-5" @submit.prevent="submit">
      <label class="flex flex-col gap-2">
        <span class="text-sm font-medium text-gray-400">{{ $t('auth.usernameOrEmail') }}</span>
        <input
          v-model="login"
          class="glass-input"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          placeholder="Aether"
          required
        />
      </label>
      <label class="flex flex-col gap-2">
        <span class="flex items-baseline justify-between gap-3">
          <span class="text-sm font-medium text-gray-400">{{ $t('common.password') }}</span>
          <RouterLink
            v-if="emailFeatures"
            :to="{ name: 'forgot-password' }"
            class="text-sm text-accent-text hover:underline"
            :title="$t('auth.forgotPasswordTitle')"
          >
            {{ $t('auth.forgotPassword') }}
          </RouterLink>
        </span>
        <input
          v-model="password"
          class="glass-input"
          type="password"
          autocomplete="current-password"
          placeholder="••••••••"
          required
        />
      </label>
      <div class="mt-2 flex flex-col">
        <HumanCheck
          v-if="siteKey"
          :key="siteKey"
          ref="human"
          v-model:ready="humanReady"
          :site-key="siteKey"
          action="login"
        />
        <button
          type="submit"
          class="btn-glow w-full rounded-xl"
          :disabled="busy || !login || !password || !humanOk"
          :title="humanOk ? undefined : $t('auth.humanCheck.wait')"
        >
          <UiSpinner v-if="busy" class="size-4" />
          {{ linking ? $t('auth.signInAndLink') : $t('common.signIn') }}
        </button>
      </div>
    </form>
    <OAuthButtons v-if="!linking" :next="next" nudge />
    <template #footer>
      <template v-if="linking">
        <RouterLink
          :to="{ name: 'oauth-continue' }"
          class="font-semibold text-accent-text hover:underline"
          :title="$t('auth.backTitle')"
        >
          {{ $t('common.back') }}
        </RouterLink>
      </template>
      <template v-else>
        {{ $t('auth.newHere') }}
        <RouterLink
          :to="{ name: 'register', query: next ? { next } : {} }"
          class="font-semibold text-accent-text hover:underline"
        >
          {{ $t('auth.createAnAccount') }}
        </RouterLink>
        <span aria-hidden="true" class="mx-1.5 text-text-muted">·</span>
        <RouterLink
          :to="{ name: 'demo-overview' }"
          class="font-semibold text-accent-text hover:underline"
          :title="$t('demo.tryHint')"
        >
          {{ $t('demo.try') }}
        </RouterLink>
      </template>
    </template>
  </AuthFrame>
</template>
