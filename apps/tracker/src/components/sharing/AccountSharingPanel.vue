<script setup lang="ts">
import {
  ACCOUNT_MEMBER_LIMIT,
  type AccountMemberResponse,
  type AccountResponse,
  type AccountRole,
} from '@gdt/shared'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiError from '@/components/ui/UiError.vue'
import UiField from '@/components/ui/UiField.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { ApiRequestError, api } from '@/api'
import { t } from '@/i18n'
import { formatDateTime, formatRelative } from '@/lib/format'
import { useAccounts } from '@/stores/accounts'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'

/**
 * Manage → Account sharing (docs/plans/account-sharing.md): everyone who can
 * see the account. The owner invites by username (they accept on their
 * Home), changes roles and removes people; a member sees the list and can
 * leave.
 */
const props = defineProps<{ account: AccountResponse }>()
const accounts = useAccounts()
const session = useSession()
const feedback = useFeedback()
const router = useRouter()

const owner = computed(() => (props.account.access ?? 'owner') === 'owner')
const members = ref<AccountMemberResponse[] | null>(null)
const error = ref<unknown>(null)
/** The member being changed, 'invite' or 'leave'. */
const busy = ref<number | 'invite' | 'leave' | null>(null)

async function load() {
  error.value = null
  try {
    members.value = await api.accountMembers(props.account.id)
  } catch (cause) {
    error.value = cause
  }
}
watch(
  () => props.account.id,
  () => {
    members.value = null
    void load()
  },
  { immediate: true },
)
// A member accepting or leaving moves the list (a live `accounts` event re-reads it).
watch(
  () => accounts.list,
  () => void load(),
)

/** The two roles; none can be picked while a change is being saved. */
const roles = computed(() =>
  (['viewer', 'editor'] as const).map((value) => ({
    value,
    label: t(`sharing.role.${value}`),
    title: t(`sharing.roleTitle.${value}`),
    disabled: busy.value !== null,
  })),
)
const full = computed(() => (members.value?.length ?? 1) - 1 >= ACCOUNT_MEMBER_LIMIT)

function since(member: AccountMemberResponse): { text: string; title: string } {
  const at = member.acceptedAt ?? member.createdAt
  return { text: formatRelative(at), title: formatDateTime(at) }
}

// --------------------------------------------------------------------- invite

const username = ref('')
const role = ref<AccountRole>('editor')
const inviteError = ref<string | undefined>()

async function invite() {
  const name = username.value.trim()
  if (!name) return
  busy.value = 'invite'
  inviteError.value = undefined
  try {
    members.value = await api.inviteMember(props.account.id, name, role.value)
    username.value = ''
    feedback.toast({ tone: 'success', title: t('sharing.invited'), hint: name })
  } catch (cause) {
    if (cause instanceof ApiRequestError && cause.issueFor('username')) {
      inviteError.value = cause.issueFor('username')
    } else {
      feedback.error(t('sharing.notInvited'), cause)
    }
  } finally {
    busy.value = null
  }
}

async function setRole(member: AccountMemberResponse, next: AccountRole) {
  if (member.access === next) return
  busy.value = member.userId
  try {
    members.value = await api.setMemberRole(props.account.id, member.userId, next)
  } catch (cause) {
    feedback.error(t('common.notSaved'), cause)
  } finally {
    busy.value = null
  }
}

async function remove(member: AccountMemberResponse) {
  const pending = member.acceptedAt === null
  const ok = await feedback.confirm({
    title: pending
      ? t('sharing.cancelTitle', { name: member.username })
      : t('sharing.removeTitle', { name: member.username }),
    detail: pending ? t('sharing.cancelDetail') : t('sharing.removeDetail'),
    confirmLabel: pending ? t('sharing.cancelInvite') : t('common.remove'),
    tone: 'danger',
  })
  if (!ok) return
  busy.value = member.userId
  try {
    await api.removeMember(props.account.id, member.userId)
    await load()
  } catch (cause) {
    feedback.error(t('sharing.notRemoved'), cause)
  } finally {
    busy.value = null
  }
}

async function leave() {
  const me = session.me
  if (!me) return
  const ok = await feedback.confirm({
    title: t('sharing.leaveTitle', { name: accounts.displayName(props.account) }),
    detail: t('sharing.leaveDetail'),
    confirmLabel: t('sharing.leave'),
    tone: 'danger',
  })
  if (!ok) return
  busy.value = 'leave'
  try {
    await api.removeMember(props.account.id, me.id)
    await accounts.refresh()
    await router.replace({ name: 'home' })
  } catch (cause) {
    feedback.error(t('sharing.notLeft'), cause)
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <UiPanel :title="$t('sharing.title')">
    <template v-if="members" #actions>
      <span
        class="tabular text-sm text-text-muted"
        :title="$t('sharing.limitTitle', { n: ACCOUNT_MEMBER_LIMIT })"
        >{{ members.length - 1 }} / {{ ACCOUNT_MEMBER_LIMIT }}</span
      >
    </template>

    <UiError
      v-if="error && !members"
      :error="error"
      :title="$t('sharing.notLoaded')"
      @retry="load"
    />
    <div v-else-if="!members" class="flex flex-col gap-3" aria-busy="true">
      <UiSkeleton v-for="n in 2" :key="n" class="h-10 w-full" />
    </div>
    <template v-else>
      <form
        v-if="owner"
        class="flex max-w-[760px] flex-wrap items-end gap-3"
        novalidate
        @submit.prevent="invite"
      >
        <UiField
          v-slot="{ id, describedBy }"
          :label="$t('common.username')"
          :error="inviteError"
          class="min-w-0 flex-[999_1_16rem]"
        >
          <UiInput
            :id="id"
            v-model="username"
            :aria-describedby="describedBy"
            :invalid="!!inviteError"
            :disabled="busy !== null || full"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
          />
        </UiField>
        <div class="flex flex-wrap items-center gap-3">
          <UiSegmented v-model="role" :options="roles" :label="$t('sharing.roleLabel')" />
          <UiButton
            type="submit"
            variant="primary"
            :loading="busy === 'invite'"
            :disabled="busy !== null || full || !username.trim()"
            :title="full ? $t('sharing.limitTitle', { n: ACCOUNT_MEMBER_LIMIT }) : undefined"
          >
            {{ $t('sharing.invite') }}
          </UiButton>
        </div>
        <p v-if="full" class="basis-full text-sm text-text-muted">
          {{ $t('sharing.fullHint', { n: ACCOUNT_MEMBER_LIMIT }) }}
        </p>
      </form>
      <ul
        class="grid grid-cols-1 gap-x-7"
        :class="[members.length >= 4 ? 'md:grid-cols-2' : '', owner ? 'mt-4' : '']"
      >
        <li
          v-for="member in members"
          :key="member.userId"
          class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border-subtle py-2.5"
          :class="member.acceptedAt === null ? 'opacity-80' : ''"
        >
          <div class="min-w-0 flex-[999_1_10rem]">
            <p class="flex min-w-0 items-center gap-2">
              <span class="truncate font-medium">{{ member.username }}</span>
              <UiBadge v-if="member.userId === session.me?.id" tone="accent">{{
                $t('sharing.you')
              }}</UiBadge>
              <UiBadge
                v-if="member.acceptedAt === null"
                tone="warning"
                :title="$t('sharing.invitedTitle')"
                >{{ $t('sharing.pending') }}</UiBadge
              >
            </p>
            <p class="truncate text-sm text-text-muted">
              <template v-if="member.access === 'owner'">{{ $t('sharing.role.owner') }}</template>
              <template v-else-if="!owner">{{ $t(`sharing.role.${member.access}`) }} · </template>
              <time v-if="member.access !== 'owner'" :title="since(member).title">{{
                since(member).text
              }}</time>
            </p>
          </div>
          <template v-if="owner && member.access !== 'owner'">
            <UiSegmented
              :model-value="member.access"
              :options="roles"
              :label="$t('sharing.roleOf', { name: member.username })"
              @update:model-value="(next: AccountRole) => setRole(member, next)"
            />
            <UiButton
              size="sm"
              variant="ghost"
              :loading="busy === member.userId"
              :disabled="busy !== null"
              @click="remove(member)"
            >
              {{ member.acceptedAt === null ? $t('sharing.cancelInvite') : $t('common.remove') }}
            </UiButton>
          </template>
        </li>
      </ul>
      <p
        v-if="owner && members.length === 1"
        class="mt-4 rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm text-text-muted"
      >
        {{ $t('sharing.onlyYou') }}
      </p>
      <div v-else class="mt-4 flex justify-end border-t border-border-default pt-4">
        <UiButton variant="danger" :loading="busy === 'leave'" @click="leave">
          {{ $t('sharing.leave') }}
        </UiButton>
      </div>
    </template>
  </UiPanel>
</template>
