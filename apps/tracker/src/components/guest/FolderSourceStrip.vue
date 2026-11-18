<script setup lang="ts">
import { computed } from 'vue'
import { FolderSync, TriangleAlert } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import { t } from '@/i18n'
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import { folder, folderSet } from '@/local/folder-state'
import { dismissRefused, pickFolder, stopWatching, watchAgain } from '@/local/folder-watch'
import FolderBadge from './FolderBadge.vue'
import FolderRefused from './FolderRefused.vue'

/**
 * Snapshots › Source strip (guest mode, design D): the watched folder over
 * the list while one is set: its state, the last file read, Change and Stop
 * (Watch again after Stop: the folder is kept). Allow again is asked only by
 * the paused toast, so a paused strip holds Change and Stop. On phones it
 * stacks and the tooltips are lines.
 */
defineProps<{ now: number }>()

type Shown = 'watching' | 'reading' | 'paused' | 'missing' | 'stopped'
const status = computed<Shown | null>(() => (folderSet(folder) ? (folder.status as Shown) : null))
const iconClass = computed(
  () =>
    ({
      watching: 'text-accent-text',
      reading: 'text-accent-text',
      paused: 'text-warning-text',
      missing: 'text-danger-text',
      stopped: 'text-text-muted',
    })[status.value ?? 'watching'],
)
/** What the badge's tooltip says, as a line on phones. */
const why = computed(() => {
  switch (status.value) {
    case 'watching':
      return t('guest.folder.cadence')
    case 'paused':
      return t('guest.folder.pausedInfo')
    case 'missing':
      return t('guest.folder.missingInfo')
    case 'stopped':
      return t('guest.folder.toast.stoppedDetail')
    default:
      return ''
  }
})
const count = computed(() =>
  folder.progress
    ? `${formatNumber(folder.progress.done)} / ${formatNumber(folder.progress.total)}`
    : '',
)
const phoneButton = 'max-lg:min-h-11'
</script>

<template>
  <section
    v-if="status"
    class="rounded-xl border border-border-default bg-surface-raised text-sm shadow-sm"
  >
    <div class="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-5">
      <div class="flex min-w-0 items-center gap-2 lg:flex-[999_1_16rem]">
        <TriangleAlert
          v-if="status === 'missing'"
          class="size-[1.125rem] shrink-0"
          :class="iconClass"
          aria-hidden="true"
        />
        <FolderSync v-else class="size-[1.125rem] shrink-0" :class="iconClass" aria-hidden="true" />
        <span class="hidden shrink-0 text-text-muted lg:inline">{{
          $t('guest.folder.source')
        }}</span>
        <b class="min-w-0 flex-1 truncate lg:flex-initial" :title="folder.name ?? undefined">{{
          folder.name
        }}</b>
        <FolderBadge :status="status" class="hidden shrink-0 lg:inline-flex" />
      </div>

      <div class="flex min-w-0 items-center gap-2.5 text-text-secondary lg:flex-[1_1_12rem]">
        <FolderBadge :status="status" class="shrink-0 lg:hidden" />
        <template v-if="status === 'reading' && folder.progress">
          <UiProgress
            class="flex-1"
            :value="folder.progress.done"
            :max="folder.progress.total"
            :label="$t('guest.folder.progress')"
          />
          <span class="tabular shrink-0">{{ count }}</span>
        </template>
        <template v-else-if="folder.last">
          <span
            class="min-w-0 flex-1 truncate font-mono text-xs"
            :title="`${$t('guest.folder.lastFile')}: ${folder.last.name}`"
            >{{ folder.last.name }}</span
          >
          <span class="tabular shrink-0" :title="formatDateTime(folder.last.at)">{{
            formatRelative(folder.last.at, now)
          }}</span>
        </template>
        <span v-else class="min-w-0 flex-1 truncate text-text-muted">{{
          $t('guest.folder.waiting')
        }}</span>
      </div>

      <p v-if="why" class="text-sm text-text-secondary lg:hidden">{{ why }}</p>

      <div class="flex flex-wrap items-center gap-2 lg:flex-none">
        <template v-if="status === 'missing'">
          <UiButton variant="primary" size="sm" :class="phoneButton" @click="pickFolder">
            {{ $t('guest.folder.choose') }}
          </UiButton>
        </template>
        <template v-else-if="status === 'stopped'">
          <UiButton variant="primary" size="sm" :class="phoneButton" @click="watchAgain">
            {{ $t('guest.folder.watchAgain') }}
          </UiButton>
          <UiButton size="sm" :class="phoneButton" @click="pickFolder">
            {{ $t('guest.folder.change') }}
          </UiButton>
        </template>
        <UiButton
          v-else-if="status !== 'reading'"
          size="sm"
          :class="phoneButton"
          @click="pickFolder"
        >
          {{ $t('guest.folder.change') }}
        </UiButton>
        <UiButton
          v-if="status !== 'stopped'"
          variant="ghost"
          size="sm"
          :class="phoneButton"
          @click="stopWatching"
        >
          {{ $t('guest.folder.stop') }}
        </UiButton>
      </div>
    </div>

    <div
      v-if="folder.refused.length > 0"
      class="flex flex-col gap-2 border-t border-border-subtle px-4 py-3 lg:flex-row lg:items-start lg:gap-5"
    >
      <FolderRefused class="lg:flex-1" />
      <UiButton
        variant="ghost"
        size="sm"
        class="self-start lg:flex-none"
        :class="phoneButton"
        @click="dismissRefused"
      >
        {{ $t('common.dismiss') }}
      </UiButton>
    </div>
  </section>
</template>
