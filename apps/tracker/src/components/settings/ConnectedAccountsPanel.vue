<script setup lang="ts">
import {
  OAUTH_PROVIDERS,
  type IdentitiesResponse,
  type IdentityResponse,
  type OAuthProvider,
} from '@gdt/shared'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Plus } from 'lucide-vue-next'
import ProviderMark from '@/components/oauth/ProviderMark.vue'
import { isProvider, oauthErrorText, providerLabel, providerNames } from '@/components/oauth/oauth'
import UiButton from '@/components/ui/UiButton.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import { ApiRequestError, api } from '@/api'
import { t } from '@/i18n'
import { formatDateTime } from '@/lib/format'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'
import PasskeyRows from './PasskeyRows.vue'
import { usePasskeys } from './passkeys'

/**
 * Discord / Google sign-in: Link (a round trip to the provider, back here)
 * and Unlink, which the server refuses while it is the only way in. Hidden
 * while the server has no provider and nothing is linked. While the email
 * features are paused there is no "forgot password", so a user with nothing
 * linked is nudged to link one. On phones it also lists the passkeys under
 * its title "Ways to sign in" (design B, the user's pick); from 900px they
 * have their own panel (PasskeysPanel, design A).
 */
const session = useSession()
const feedback = useFeedback()
const route = useRoute()
const router = useRouter()

const data = ref<IdentitiesResponse | null>(null)
const busy = ref<OAuthProvider | null>(null)
const passkeys = usePasskeys()
const passkeyList = passkeys.list
const passkeysShown = passkeys.shown

const rows = computed(() =>
  OAUTH_PROVIDERS.filter(
    (provider) =>
      data.value?.providers.includes(provider) ||
      data.value?.identities.some((identity) => identity.provider === provider),
  ).map((provider) => ({
    provider,
    enabled: data.value?.providers.includes(provider) ?? false,
    identity: data.value?.identities.find((identity) => identity.provider === provider) ?? null,
  })),
)

/** Nothing linked and no email recovery: the providers to suggest, by name. */
const nudge = computed(() =>
  session.me?.emailFeatures === false && data.value?.identities.length === 0
    ? providerNames(data.value.providers)
    : '',
)

/** Unlinking must leave a way in: a password, another linked account or a passkey. */
const canUnlink = computed(
  () =>
    session.me?.hasPassword === true ||
    (data.value?.identities.length ?? 0) > 1 ||
    (passkeyList.value?.length ?? 0) > 0,
)

async function load() {
  try {
    data.value = await api.identities()
    passkeys.identityCount.value = data.value.identities.length
  } catch (cause) {
    feedback.error(t('settings.connected.notLoaded'), cause)
  }
}

onMounted(async () => {
  // Back from linking: say how it went once, then drop it from the URL.
  const { linked, oauth_error: problem } = route.query
  if (isProvider(linked)) {
    feedback.toast({
      tone: 'success',
      title: t('settings.connected.linked', { provider: providerLabel(linked) }),
    })
  } else if (typeof problem === 'string') {
    feedback.toast({
      tone: 'danger',
      title: t('settings.connected.notLinked'),
      detail: oauthErrorText(problem),
    })
  }
  if (linked !== undefined || problem !== undefined) {
    void router.replace({ query: { ...route.query, linked: undefined, oauth_error: undefined } })
  }
  await load()
})

async function link(provider: OAuthProvider) {
  busy.value = provider
  try {
    const { url } = await api.oauthLink(provider)
    window.location.assign(url)
  } catch (cause) {
    busy.value = null
    feedback.error(
      t('settings.connected.couldNotLink', { provider: providerLabel(provider) }),
      cause,
    )
  }
}

async function unlink(provider: OAuthProvider) {
  const label = providerLabel(provider)
  const ok = await feedback.confirm({
    title: t('settings.connected.unlinkTitle', { provider: label }),
    detail: t('settings.connected.unlinkDetail', { provider: label }),
    confirmLabel: t('settings.connected.unlink'),
    tone: 'danger',
  })
  if (!ok) return
  busy.value = provider
  try {
    await api.unlinkIdentity(provider)
    feedback.toast({
      tone: 'success',
      title: t('settings.connected.unlinked', { provider: label }),
    })
  } catch (cause) {
    feedback.error(t('settings.connected.notUnlinked', { provider: label }), cause)
  } finally {
    busy.value = null
    await load()
  }
}

/** The provider's email as the account's (only while it has none): confirmed by mail as usual. */
async function useEmail(identity: IdentityResponse) {
  if (!identity.email) return
  busy.value = identity.provider
  try {
    await session.updateProfile({ email: identity.email })
    feedback.toast({
      tone: 'success',
      title: t('settings.connected.emailSet'),
      detail: session.me?.emailEnabled
        ? t('settings.profile.confirmationSent', { email: identity.email })
        : undefined,
    })
  } catch (cause) {
    const taken = cause instanceof ApiRequestError && cause.code === 'email_taken'
    feedback.error(
      t('settings.connected.emailNotSet'),
      taken ? new Error(t('settings.connected.belongsToAnother')) : cause,
    )
  } finally {
    busy.value = null
  }
}

function details(identity: IdentityResponse): string {
  const lines = [
    identity.email ?? '',
    t('settings.connected.linkedAt', { date: formatDateTime(identity.createdAt) }),
  ]
  if (identity.lastUsedAt) {
    lines.push(t('settings.connected.lastSignIn', { date: formatDateTime(identity.lastUsedAt) }))
  }
  return lines.filter(Boolean).join('\n')
}
</script>

<template>
  <UiPanel v-if="rows.length || passkeysShown" :class="rows.length ? '' : 'min-[900px]:hidden'">
    <template #header>
      <h2 class="text-base font-semibold">
        <template v-if="passkeysShown">
          <span class="min-[900px]:hidden">{{ $t('settings.passkeys.ways') }}</span>
          <span class="hidden min-[900px]:inline">{{ $t('settings.connected.title') }}</span>
        </template>
        <template v-else>{{ $t('settings.connected.title') }}</template>
      </h2>
    </template>
    <p
      v-if="nudge"
      class="mb-3 text-sm text-text-muted"
      :title="$t('settings.connected.nudgeTitle')"
    >
      {{ $t('settings.connected.nudge', { providers: nudge }) }}
    </p>
    <ul v-if="rows.length" class="flex flex-col divide-y divide-border-subtle">
      <li
        v-for="row in rows"
        :key="row.provider"
        class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
      >
        <div class="flex min-w-0 items-center gap-3">
          <ProviderMark :provider="row.provider" class="size-5 shrink-0" />
          <div class="min-w-0">
            <p class="font-medium">{{ providerLabel(row.provider) }}</p>
            <p
              v-if="row.identity"
              class="truncate text-sm text-text-muted"
              :title="details(row.identity)"
            >
              {{
                row.identity.displayName ??
                row.identity.email ??
                $t('settings.connected.linkedFallback')
              }}
            </p>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <template v-if="row.identity">
            <UiButton
              v-if="session.me?.emailFeatures && !session.me.email && row.identity.email"
              size="sm"
              variant="ghost"
              :disabled="busy !== null"
              :title="$t('settings.connected.useEmailTitle', { email: row.identity.email })"
              @click="useEmail(row.identity)"
            >
              {{ $t('settings.connected.useEmail') }}
            </UiButton>
            <span :title="canUnlink ? undefined : $t('settings.connected.unlinkBlocked')">
              <UiButton
                size="sm"
                :loading="busy === row.provider"
                :disabled="busy !== null || !canUnlink"
                @click="unlink(row.provider)"
              >
                {{ $t('settings.connected.unlink') }}
              </UiButton>
            </span>
          </template>
          <UiButton
            v-else
            size="sm"
            :loading="busy === row.provider"
            :disabled="busy !== null || !row.enabled"
            :title="$t('settings.connected.linkTitle', { provider: providerLabel(row.provider) })"
            @click="link(row.provider)"
          >
            {{ $t('settings.connected.link') }}
          </UiButton>
        </div>
      </li>
    </ul>
    <div
      v-if="passkeysShown"
      class="min-[900px]:hidden"
      :class="rows.length ? 'mt-4 border-t border-border-subtle pt-4' : ''"
    >
      <h3 class="mb-3 text-xs font-semibold tracking-wider text-text-muted uppercase">
        {{ $t('settings.passkeys.title') }}
      </h3>
      <PasskeyRows v-if="passkeyList?.length" compact />
      <p v-else-if="passkeys.failed.value" class="text-sm text-text-muted">
        {{ $t('settings.passkeys.notLoaded') }}
      </p>
      <UiButton
        v-if="passkeys.available.value"
        size="sm"
        class="mt-4"
        :loading="passkeys.busy.value === 'add'"
        :disabled="passkeys.busy.value !== null"
        :title="$t('settings.passkeys.addTitle')"
        @click="passkeys.add"
      >
        <Plus v-if="passkeys.busy.value !== 'add'" class="size-4" aria-hidden="true" />
        {{ $t('settings.passkeys.add') }}
      </UiButton>
    </div>
  </UiPanel>
</template>
