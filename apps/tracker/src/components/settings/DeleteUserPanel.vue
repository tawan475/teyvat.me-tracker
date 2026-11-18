<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight, Trash2 } from 'lucide-vue-next'
import DeleteUserDialog from '@/components/staff/DeleteUserDialog.vue'
import UiButton from '@/components/ui/UiButton.vue'
import { t } from '@/i18n'
import { useAccounts } from '@/stores/accounts'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'

/**
 * Deletes the user and everything they own, after they type their
 * username: every Genshin account, snapshot, key and sign-in. Signs out.
 */
const session = useSession()
const accounts = useAccounts()
const feedback = useFeedback()
const router = useRouter()
const open = ref(false)
const busy = ref(false)

const me = computed(() =>
  session.me ? { id: session.me.id, username: session.me.username } : null,
)
/** Only the user's own accounts go (ones shared with them stay with their owners). */
const owned = computed(() => accounts.list.filter((a) => (a.access ?? 'owner') === 'owner'))
const figures = computed(() => ({
  accounts: owned.value.length,
  snapshots: owned.value.reduce((n, a) => n + a.snapshotCount, 0),
  storedBytes: owned.value.reduce((n, a) => n + a.storedBytes, 0),
}))

async function remove(username: string) {
  busy.value = true
  try {
    await session.deleteMe(username)
    accounts.clear()
    open.value = false
    feedback.toast({ tone: 'success', title: t('settings.deleteUser.deleted') })
    await router.replace({ name: 'landing' })
  } catch (error) {
    feedback.error(t('common.notDeleted'), error)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="rounded-xl border border-danger-border bg-surface-raised shadow-sm">
    <div class="flex flex-wrap items-center justify-between gap-4 p-5">
      <div class="min-w-0">
        <h2 class="text-base font-semibold">{{ $t('settings.deleteUser.title') }}</h2>
        <p class="text-sm text-text-muted">{{ $t('settings.deleteUser.body') }}</p>
        <RouterLink
          :to="{ name: 'privacy' }"
          class="mt-1 inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-accent-text hover:underline"
          >{{ $t('settings.deleteUser.privacy') }}<ArrowRight class="size-4" aria-hidden="true"
        /></RouterLink>
      </div>
      <UiButton variant="danger" @click="open = true">
        <Trash2 class="size-4" aria-hidden="true" />
        {{ $t('common.delete') }}
      </UiButton>
    </div>
    <DeleteUserDialog
      :open="open"
      :user="me"
      :figures="figures"
      :title="$t('settings.deleteUser.dialogTitle')"
      :busy="busy"
      @close="open = false"
      @confirm="remove"
    />
  </section>
</template>
