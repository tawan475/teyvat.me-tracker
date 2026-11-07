<script setup lang="ts">
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  appPath,
  emailSchema,
  usernameSchema,
  type SignupMode,
} from '@gdt/shared'
import { computed, onMounted, ref, useTemplateRef } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import HumanCheck from '@/components/auth/HumanCheck.vue'
import { humanCheckNeeded, humanCheckPassed, siteKeyAfter } from '@/components/auth/human-check'
import OAuthButtons from '@/components/oauth/OAuthButtons.vue'
import { loadSignInOptions } from '@/components/oauth/oauth'
import UiSpinner from '@/components/ui/UiSpinner.vue'
import { ApiRequestError } from '@/api'
import { t } from '@/i18n'
import { errorText } from '@/i18n/api-errors'
import { useSession } from '@/stores/session'
import AuthFrame from './AuthFrame.vue'

const session = useSession()
const router = useRouter()
const route = useRoute()
/** Back to irminsul's /link (or another app page) after signing up, when sign-in sent us here. */
const next = computed(() =>
  appPath.safeParse(route.query.next).success ? (route.query.next as string) : undefined,
)

const username = ref('')
const email = ref('')
const password = ref('')
const confirm = ref('')
const touched = ref(false)
const serverError = ref('')
const busy = ref(false)
/** The optional email field shows only while the email features are on. */
const emailFeatures = ref(false)
/** The human check's site key while the server has it on (null: off; undefined: not asked yet). */
const siteKey = ref<string | null | undefined>(undefined)
const human = useTemplateRef<InstanceType<typeof HumanCheck>>('human')
/** HumanCheck holds a fresh token. */
const humanReady = ref(false)
const humanOk = computed(() => humanCheckPassed(siteKey.value, humanReady.value))
/** The staff switch: `oauth` leaves only Discord / Google, `closed` nothing. */
const signups = ref<SignupMode>('open')

onMounted(async () => {
  const options = await loadSignInOptions()
  emailFeatures.value = options.emailFeatures
  siteKey.value = options.turnstileSiteKey
  signups.value = options.signups
})

// The same schemas the server validates with.
const errors = computed(() => ({
  username: usernameSchema.safeParse(username.value).success ? '' : t('auth.usernameRule'),
  email:
    !emailFeatures.value || !email.value.trim() || emailSchema.safeParse(email.value).success
      ? ''
      : t('auth.invalidEmail'),
  password:
    password.value.length < MIN_PASSWORD_LENGTH
      ? t('auth.minChars', { n: MIN_PASSWORD_LENGTH })
      : password.value.length > MAX_PASSWORD_LENGTH
        ? t('auth.maxChars', { n: MAX_PASSWORD_LENGTH })
        : '',
  confirm: confirm.value !== password.value ? t('auth.doesNotMatch') : '',
}))
const valid = computed(() => Object.values(errors.value).every((e) => !e))
const show = (field: keyof typeof errors.value) => (touched.value ? errors.value[field] : '')

async function submit() {
  touched.value = true
  serverError.value = ''
  if (!valid.value) return
  busy.value = true
  try {
    const turnstile = siteKey.value ? await human.value?.token() : undefined
    await session.register(
      username.value.trim(),
      (emailFeatures.value && email.value.trim()) || null,
      password.value,
      turnstile,
    )
    await router.replace(next.value ?? { name: 'account-new' })
  } catch (cause) {
    const key = await siteKeyAfter(cause)
    if (key) siteKey.value = key
    serverError.value = key
      ? humanCheckNeeded()
      : cause instanceof ApiRequestError && cause.code === 'taken'
        ? emailFeatures.value
          ? t('auth.usernameOrEmailTaken')
          : t('auth.usernameTaken')
        : errorText(cause, t('auth.signUpFailed'))
  } finally {
    // A token works once, whatever the answer.
    human.value?.reset()
    busy.value = false
  }
}
</script>

<template>
  <AuthFrame :title="$t('auth.createAccount')" :subtitle="$t('auth.registerSub')">
    <p
      v-if="serverError"
      class="mb-4 rounded-lg border border-red-500/50 bg-red-500/20 p-3 text-sm text-red-300"
      role="alert"
    >
      {{ serverError }}
    </p>
    <p
      v-if="signups !== 'open'"
      class="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/15 p-3 text-sm text-amber-200"
      role="status"
    >
      {{ signups === 'oauth' ? $t('auth.signupsOauth') : $t('auth.signupsClosed') }}
    </p>
    <form v-if="signups === 'open'" class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <label class="flex flex-col gap-2">
        <span class="text-sm font-medium text-gray-400">{{ $t('common.username') }}</span>
        <input
          v-model="username"
          class="glass-input"
          :aria-invalid="!!show('username') || undefined"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
        />
        <span v-if="show('username')" class="text-sm text-red-300">{{ show('username') }}</span>
      </label>
      <label v-if="emailFeatures" class="flex flex-col gap-2">
        <span class="text-sm font-medium text-gray-400"
          >{{ $t('common.email') }}
          <span class="text-gray-500">{{ $t('common.optional') }}</span></span
        >
        <input
          v-model="email"
          class="glass-input"
          type="email"
          :aria-invalid="!!show('email') || undefined"
          autocomplete="email"
        />
        <span v-if="show('email')" class="text-sm text-red-300">{{ show('email') }}</span>
      </label>
      <label class="flex flex-col gap-2">
        <span class="text-sm font-medium text-gray-400">{{ $t('common.password') }}</span>
        <input
          v-model="password"
          class="glass-input"
          type="password"
          :aria-invalid="!!show('password') || undefined"
          autocomplete="new-password"
        />
        <span v-if="show('password')" class="text-sm text-red-300">{{ show('password') }}</span>
      </label>
      <label class="flex flex-col gap-2">
        <span class="text-sm font-medium text-gray-400">{{ $t('auth.confirmPassword') }}</span>
        <input
          v-model="confirm"
          class="glass-input"
          type="password"
          :aria-invalid="!!show('confirm') || undefined"
          autocomplete="new-password"
        />
        <span v-if="show('confirm')" class="text-sm text-red-300">{{ show('confirm') }}</span>
      </label>
      <div class="mt-2 flex flex-col">
        <HumanCheck
          v-if="siteKey"
          :key="siteKey"
          ref="human"
          v-model:ready="humanReady"
          :site-key="siteKey"
          action="register"
        />
        <button
          type="submit"
          class="btn-glow w-full rounded-xl"
          :disabled="busy || !humanOk"
          :title="humanOk ? undefined : $t('auth.humanCheck.wait')"
        >
          <UiSpinner v-if="busy" class="size-4" />
          {{ $t('auth.createAccount') }}
        </button>
      </div>
    </form>
    <OAuthButtons :next="next" guest :no-providers="signups === 'closed'" />
    <template #footer>
      {{ $t('auth.haveAccount') }}
      <RouterLink
        :to="{ name: 'login', query: next ? { next } : {} }"
        class="font-semibold text-accent-text hover:underline"
      >
        {{ $t('common.signIn') }}
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
  </AuthFrame>
</template>
