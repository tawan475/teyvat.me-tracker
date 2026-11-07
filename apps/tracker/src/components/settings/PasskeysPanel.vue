<script setup lang="ts">
import { Plus } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import PasskeyRows from './PasskeyRows.vue'
import { usePasskeys } from './passkeys'

/**
 * Settings → Account's Passkeys panel (design A, desktop): "Add a passkey"
 * in the header, the rows under it. On phones the same rows sit inside the
 * Connected accounts card instead (design B), so SettingsView hides this
 * panel there.
 */
const { list, failed, available, busy, shown, add } = usePasskeys()
</script>

<template>
  <UiPanel v-if="shown" :title="$t('settings.passkeys.title')">
    <template #actions>
      <UiButton
        v-if="available"
        size="sm"
        :loading="busy === 'add'"
        :disabled="busy !== null"
        :title="$t('settings.passkeys.addTitle')"
        @click="add"
      >
        <Plus v-if="busy !== 'add'" class="size-4" aria-hidden="true" />
        {{ $t('settings.passkeys.add') }}
      </UiButton>
    </template>
    <PasskeyRows v-if="list?.length" />
    <p v-else-if="failed" class="text-sm text-text-muted">
      {{ $t('settings.passkeys.notLoaded') }}
    </p>
    <p v-else-if="list" class="text-sm text-text-muted">{{ $t('settings.passkeys.none') }}</p>
  </UiPanel>
</template>
