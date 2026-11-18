<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { FolderSync, History, Upload } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import { formatNumber } from '@/lib/format'
import { folder } from '@/local/folder-state'
import { pickFolder } from '@/local/folder-watch'
import FolderBadge from './FolderBadge.vue'
import FolderTip from './FolderTip.vue'

/**
 * The guest's empty Overview (design D): where the browser has the folder
 * picker, Watch a folder first and Import second (the ⓘ says where Capture
 * writes); the first read's progress in its place; a folder set but empty,
 * its line. Without the picker, Import alone (as before).
 */
defineProps<{ importRoute: RouteLocationRaw; readOnly: boolean }>()

const view = computed(() => {
  if (folder.status === 'reading' && folder.first) return 'reading'
  if (folder.status === 'none' || folder.status === 'stopped') return 'offer'
  if (folder.status === 'unsupported') return 'import'
  return 'set'
})
/** The badge of a folder that is set (not none, not unsupported). */
const setStatus = computed(() =>
  folder.status === 'none' || folder.status === 'unsupported' ? 'watching' : folder.status,
)
const count = computed(() =>
  folder.progress
    ? `${formatNumber(folder.progress.done)} / ${formatNumber(folder.progress.total)}`
    : '',
)
</script>

<template>
  <UiPanel flush>
    <div v-if="view === 'reading'" class="flex flex-col gap-3 px-6 py-8">
      <div class="flex min-w-0 items-center gap-2">
        <FolderSync class="size-[1.125rem] shrink-0 text-accent-text" aria-hidden="true" />
        <b class="min-w-0 flex-1 truncate" :title="folder.name ?? undefined">{{ folder.name }}</b>
        <FolderBadge status="reading" />
      </div>
      <div v-if="folder.progress" class="flex items-center gap-2.5">
        <UiProgress
          class="flex-1"
          :value="folder.progress.done"
          :max="folder.progress.total"
          :label="$t('guest.folder.progress')"
        />
        <span class="tabular shrink-0 text-sm text-text-secondary">{{ count }}</span>
      </div>
    </div>

    <UiEmpty v-else :title="$t('overview.noSnapshots')">
      <template #icon><History aria-hidden="true" /></template>
      <template v-if="view === 'set'">
        <div class="flex w-full flex-col items-center gap-2">
          <p class="flex max-w-full min-w-0 items-center justify-center gap-2 text-sm">
            <FolderSync class="size-[1.125rem] shrink-0 text-accent-text" aria-hidden="true" />
            <b class="min-w-0 truncate" :title="folder.name ?? undefined">{{ folder.name }}</b>
            <FolderBadge :status="setStatus" />
            <FolderTip mode="icon" :text="$t('guest.folder.where')" />
          </p>
          <FolderTip
            v-if="folder.status === 'watching'"
            mode="line"
            :text="$t('guest.folder.cadence')"
          />
          <FolderTip mode="line" glyph :text="$t('guest.folder.where')" />
          <UiButton v-if="!readOnly" class="max-lg:min-h-11" :to="importRoute">
            <Upload class="size-4" aria-hidden="true" />
            {{ $t('overview.import') }}
          </UiButton>
        </div>
      </template>
      <template v-else-if="!readOnly">
        <UiButton
          v-if="view === 'offer'"
          variant="primary"
          class="max-lg:min-h-11"
          @click="pickFolder"
        >
          <FolderSync class="size-4" aria-hidden="true" />
          {{ $t('guest.folder.watch') }}
        </UiButton>
        <UiButton
          :variant="view === 'offer' ? 'secondary' : 'primary'"
          class="max-lg:min-h-11"
          :to="importRoute"
        >
          <Upload class="size-4" aria-hidden="true" />
          {{ $t('overview.import') }}
        </UiButton>
        <FolderTip
          v-if="view === 'offer'"
          mode="icon"
          class="self-center"
          :text="$t('guest.folder.where')"
        />
        <FolderTip
          v-if="view === 'offer'"
          mode="line"
          glyph
          class="basis-full justify-center"
          :text="$t('guest.folder.where')"
        />
      </template>
    </UiEmpty>
  </UiPanel>
</template>
