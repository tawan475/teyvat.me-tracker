<script setup lang="ts">
import type { PasskeyResponse } from '@gdt/shared'
import { nextTick, ref, useTemplateRef } from 'vue'
import { KeyRound, Pencil, Trash2 } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import { t } from '@/i18n'
import { formatDate, formatDateTime, formatRelative } from '@/lib/format'
import { usePasskeys } from './passkeys'

/**
 * The user's passkeys as rows: name, when added and last used (the exact
 * dates in the tooltip), rename in place and remove. `compact`: the phone
 * look inside the Connected accounts card (a small key, no tile).
 */
defineProps<{ compact?: boolean }>()

const { list, busy, canRemove, rename, remove } = usePasskeys()
const editing = ref<number | null>(null)
const draft = ref('')
const field = useTemplateRef<HTMLElement[]>('field')

function meta(row: PasskeyResponse): string {
  const added = t('settings.passkeys.addedOn', { date: formatDate(row.createdAt) })
  const used = row.lastUsedAt
    ? t('settings.passkeys.usedAgo', { when: formatRelative(row.lastUsedAt) })
    : t('settings.passkeys.notUsed')
  return `${added} · ${used}`
}

function dates(row: PasskeyResponse): string {
  return [
    t('settings.passkeys.addedOn', { date: formatDateTime(row.createdAt) }),
    row.lastUsedAt
      ? t('settings.passkeys.usedAgo', { when: formatDateTime(row.lastUsedAt) })
      : t('settings.passkeys.notUsed'),
  ].join('\n')
}

async function startRename(row: PasskeyResponse) {
  editing.value = row.id
  draft.value = row.name
  await nextTick()
  field.value?.[0]?.querySelector('input')?.select()
}

async function save(row: PasskeyResponse) {
  if (await rename(row, draft.value)) editing.value = null
}
</script>

<template>
  <ul class="flex flex-col divide-y divide-border-subtle">
    <li
      v-for="row in list ?? []"
      :key="row.id"
      class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0"
    >
      <KeyRound v-if="compact" class="size-5 shrink-0 text-accent-text" aria-hidden="true" />
      <span
        v-else
        class="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent-text"
        aria-hidden="true"
      >
        <KeyRound class="size-[1.125rem]" />
      </span>

      <form
        v-if="editing === row.id"
        ref="field"
        class="flex min-w-0 flex-[999_1_14rem] flex-wrap items-center gap-2"
        @submit.prevent="save(row)"
        @keydown.esc="editing = null"
      >
        <UiInput
          v-model="draft"
          class="min-w-0 flex-[999_1_10rem]"
          maxlength="64"
          :aria-label="$t('settings.passkeys.nameLabel')"
        />
        <div class="flex gap-2">
          <UiButton size="sm" variant="ghost" @click="editing = null">
            {{ $t('common.cancel') }}
          </UiButton>
          <UiButton
            size="sm"
            variant="primary"
            type="submit"
            :loading="busy === row.id"
            :disabled="!draft.trim()"
          >
            {{ $t('common.save') }}
          </UiButton>
        </div>
      </form>

      <template v-else>
        <div class="min-w-0 flex-1" :title="dates(row)">
          <p class="truncate font-medium">{{ row.name }}</p>
          <p class="text-sm text-text-muted" :class="compact ? '' : 'truncate'">{{ meta(row) }}</p>
        </div>
        <div class="flex shrink-0 items-center">
          <UiIconButton
            :label="$t('settings.passkeys.rename')"
            :disabled="busy !== null"
            @click="startRename(row)"
          >
            <Pencil class="size-[1.125rem]" aria-hidden="true" />
          </UiIconButton>
          <span :title="canRemove ? undefined : $t('settings.passkeys.lastWay')">
            <UiIconButton
              :label="$t('common.remove')"
              :disabled="busy !== null || !canRemove"
              class="disabled:pointer-events-none disabled:opacity-50"
              @click="remove(row)"
            >
              <Trash2 class="size-[1.125rem]" aria-hidden="true" />
            </UiIconButton>
          </span>
        </div>
      </template>
    </li>
  </ul>
</template>
