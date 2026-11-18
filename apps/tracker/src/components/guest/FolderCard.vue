<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { computed, ref } from 'vue'
import { FolderSync, TriangleAlert } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { t } from '@/i18n'
import { formatDateTime, formatNumber, formatRelative } from '@/lib/format'
import { folder, folderToasts, setFolderToasts } from '@/local/folder-state'
import { dismissRefused, pickFolder, stopWatching, watchAgain } from '@/local/folder-watch'
import FolderBadge from './FolderBadge.vue'
import FolderRefused from './FolderRefused.vue'
import FolderTip from './FolderTip.vue'

/**
 * Settings › Sync, guest mode (design D): the watched folder's card, first
 * and full width above the locks. Not set: Choose folder. Set: the folder,
 * its state, what it reads, the last file, Change / Stop (Watch again after
 * Stop), refused files, and the switch for the batch toasts (per browser).
 * Without the folder picker (Firefox, Safari, phone browsers): the note.
 */
const now = ref(Date.now())
useIntervalFn(() => (now.value = Date.now()), 30_000)

const toasts = computed({
  get: () => folderToasts.value,
  set: (on: boolean) => setFolderToasts(on),
})
const iconClass = computed(
  () =>
    ({
      watching: 'text-accent-text',
      reading: 'text-accent-text',
      paused: 'text-warning-text',
      missing: 'text-danger-text',
      stopped: 'text-text-muted',
      none: 'text-text-muted',
      unsupported: 'text-text-muted',
    })[folder.status],
)
const count = computed(() =>
  folder.progress
    ? `${formatNumber(folder.progress.done)} / ${formatNumber(folder.progress.total)}`
    : '',
)
const why = computed(() =>
  folder.status === 'watching'
    ? t('guest.folder.cadence')
    : folder.status === 'paused'
      ? t('guest.folder.pausedInfo')
      : folder.status === 'missing'
        ? t('guest.folder.missingInfo')
        : '',
)
const phoneButton = 'max-lg:min-h-11'
</script>

<template>
  <section
    class="flex min-w-0 flex-col gap-3 rounded-xl border border-border-default bg-surface-raised p-4 text-sm shadow-sm"
  >
    <div class="flex min-w-0 items-center gap-2">
      <h3 class="min-w-0 truncate text-base font-semibold">{{ $t('guest.folder.watch') }}</h3>
      <FolderTip
        v-if="folder.status !== 'unsupported'"
        mode="icon"
        :text="$t('guest.folder.where')"
      />
    </div>

    <template v-if="folder.status === 'unsupported'">
      <div><FolderBadge status="unsupported" /></div>
      <p class="text-text-secondary">{{ $t('guest.folder.unsupportedInfo') }}</p>
    </template>

    <template v-else-if="folder.status === 'none'">
      <FolderTip mode="line" glyph :text="$t('guest.folder.where')" />
      <p class="flex min-w-0 items-center gap-2 text-text-muted">
        <FolderSync class="size-[1.125rem] shrink-0" aria-hidden="true" />
        <span class="truncate">{{ $t('guest.folder.notSet') }}</span>
      </p>
      <div>
        <UiButton variant="primary" size="sm" :class="phoneButton" @click="pickFolder">
          <FolderSync class="size-4" aria-hidden="true" />
          {{ $t('guest.folder.choose') }}
        </UiButton>
      </div>
    </template>

    <template v-else>
      <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <p class="flex min-w-0 flex-[999_1_12rem] items-center gap-2">
          <TriangleAlert
            v-if="folder.status === 'missing'"
            class="size-[1.125rem] shrink-0"
            :class="iconClass"
            aria-hidden="true"
          />
          <FolderSync
            v-else
            class="size-[1.125rem] shrink-0"
            :class="iconClass"
            aria-hidden="true"
          />
          <b class="min-w-0 truncate" :title="folder.name ?? undefined">{{ folder.name }}</b>
        </p>
        <FolderBadge :status="folder.status" />
      </div>
      <p v-if="why" class="text-sm text-text-secondary lg:hidden">{{ why }}</p>

      <template v-if="folder.status === 'reading' && folder.progress">
        <div class="flex items-center gap-2.5">
          <UiProgress
            class="flex-1"
            :value="folder.progress.done"
            :max="folder.progress.total"
            :label="$t('guest.folder.progress')"
          />
          <span class="tabular shrink-0 text-text-secondary">{{ count }}</span>
        </div>
      </template>

      <p v-if="folder.status === 'stopped'" class="text-text-muted">
        {{ $t('guest.folder.toast.stoppedDetail') }}
      </p>

      <dl
        v-if="folder.status === 'watching' || folder.status === 'paused'"
        class="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-4 gap-y-1 text-text-secondary"
      >
        <template v-if="folder.status === 'watching'">
          <dt class="text-text-muted">{{ $t('guest.folder.reads') }}</dt>
          <dd class="min-w-0">{{ $t('guest.folder.readsValue') }}</dd>
        </template>
        <dt class="text-text-muted">{{ $t('guest.folder.lastFile') }}</dt>
        <dd class="flex min-w-0 items-center gap-1.5">
          <template v-if="folder.last">
            <span class="min-w-0 truncate font-mono text-xs">{{ folder.last.name }}</span>
            <span class="tabular shrink-0" :title="formatDateTime(folder.last.at)"
              >· {{ formatRelative(folder.last.at, now) }}</span
            >
          </template>
          <span v-else class="text-text-muted">{{ $t('guest.folder.waiting') }}</span>
        </dd>
      </dl>

      <FolderRefused v-if="folder.status !== 'reading'" />

      <div class="flex flex-wrap items-center gap-2">
        <template v-if="folder.status === 'missing'">
          <UiButton variant="primary" size="sm" :class="phoneButton" @click="pickFolder">
            {{ $t('guest.folder.choose') }}
          </UiButton>
        </template>
        <template v-else-if="folder.status === 'stopped'">
          <UiButton variant="primary" size="sm" :class="phoneButton" @click="watchAgain">
            {{ $t('guest.folder.watchAgain') }}
          </UiButton>
          <UiButton size="sm" :class="phoneButton" @click="pickFolder">
            {{ $t('guest.folder.change') }}
          </UiButton>
        </template>
        <UiButton
          v-else-if="folder.status !== 'reading'"
          size="sm"
          :class="phoneButton"
          @click="pickFolder"
        >
          {{ $t('guest.folder.change') }}
        </UiButton>
        <UiButton
          v-if="folder.refused.length > 0 && folder.status !== 'reading'"
          size="sm"
          :class="phoneButton"
          @click="dismissRefused"
        >
          {{ $t('common.dismiss') }}
        </UiButton>
        <UiButton
          v-if="folder.status !== 'stopped'"
          variant="ghost"
          size="sm"
          :class="phoneButton"
          @click="stopWatching"
        >
          {{ $t('guest.folder.stop') }}
        </UiButton>
      </div>

      <UiSwitch
        v-if="folder.status === 'watching'"
        v-model="toasts"
        class="min-h-11 border-t border-border-subtle pt-3"
        :label="$t('guest.folder.mute')"
        :description="$t('guest.folder.muteHint')"
        :states="{ on: $t('guest.folder.on'), off: $t('guest.folder.off') }"
      />
    </template>
  </section>
</template>
