<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Gift, Search, SearchX } from 'lucide-vue-next'
import NotCaptured from './NotCaptured.vue'
import PageBackdrop from '@/components/ui/PageBackdrop.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiProgress from '@/components/ui/UiProgress.vue'
import UiSegmented, { type SegmentedOption } from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiStat from '@/components/ui/UiStat.vue'
import type { CapturedCollections } from '@/data/collections'
import type { CollectionCatalog } from '@/data/collection-names'
import {
  musicSongs,
  musicSummary,
  shownSongs,
  type Beatmap,
  type SongFilter,
  type SongSort,
} from '@/data/music'
import { t } from '@/i18n'
import { giCdnArt } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'

/**
 * The music game (Capture's `gi_collections.musicGame`): every song with a
 * score box per difficulty, a check where the beatmap's reward is claimed
 * and a gift where it is played but still waiting. Covers are the game's
 * round `…_S` art on gi-cdn (nanoka has none).
 */
const props = defineProps<{ captured: CapturedCollections; catalog: CollectionCatalog }>()

const captured = computed(() => props.captured.musicGame?.value ?? null)
const songs = computed(() => (captured.value ? musicSongs(props.catalog, captured.value) : []))
const summary = computed(() => musicSummary(songs.value))

const FILTERS: SongFilter[] = ['all', 'played', 'left']
const KEY = 'collections:music'
const stored = readStorage(KEY) as SongFilter | null
const filter = ref<SongFilter>(stored && FILTERS.includes(stored) ? stored : 'all')
watch(filter, (value) => writeStorage(KEY, value === 'all' ? null : value))
const sort = ref<SongSort>('game')
const search = ref('')

const options = computed<SegmentedOption<SongFilter>[]>(() => {
  const counts = {
    all: songs.value.length,
    played: songs.value.filter((s) => s.played).length,
    left: songs.value.filter((s) => s.rewardLeft > 0).length,
  }
  return FILTERS.map((value) => ({
    value,
    label: t(`collections.music.filters.${value}`),
    count: counts[value],
    icon: value === 'left' ? Gift : undefined,
  }))
})
const sorts = computed(() =>
  (['game', 'score', 'name'] as const).map((value) => ({
    value,
    label: t(`collections.music.sort.${value}`),
  })),
)
const shown = computed(() => shownSongs(songs.value, filter.value, search.value, sort.value))
/** The page backdrop's wall: the first covers in the game's order (design "Page backdrop"). */
const wall = computed(() =>
  songs.value
    .map((song) => cover(song.icon))
    .filter(Boolean)
    .slice(0, 72),
)

const difficulty = (d: number) => t(`collections.music.difficulty.${d}`)
function boxTitle(b: Beatmap): string {
  const parts = [difficulty(b.difficulty)]
  if (b.played) parts.push(t('collections.music.score', { n: formatNumber(b.score ?? 0) }))
  else parts.push(t('collections.music.notPlayed'))
  if (b.rewarded) {
    parts.push(
      b.claimed
        ? t('collections.music.rewardClaimed')
        : b.played
          ? t('collections.music.rewardWaiting')
          : t('collections.music.rewardLocked'),
    )
  }
  return parts.join(' · ')
}
const cover = (icon: string) => (icon ? giCdnArt(`${icon}_S`) : '')
</script>

<template>
  <NotCaptured v-if="!captured" :title="$t('collections.tabs.music')" />
  <div v-else class="flex flex-col gap-4">
    <PageBackdrop :images="wall" />
    <ul
      class="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4"
      :aria-label="$t('collections.summary')"
    >
      <li class="flex min-w-0">
        <UiStat :label="$t('collections.music.songsPlayed')">
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(summary.songsPlayed)
              }}<span class="text-sm text-text-muted"> / {{ formatNumber(summary.songs) }}</span>
            </span>
          </template>
          <UiProgress
            class="mt-1"
            :value="summary.songsPlayed"
            :max="summary.songs"
            :label="$t('collections.music.songsPlayed')"
          />
        </UiStat>
      </li>
      <li class="flex min-w-0">
        <UiStat :label="$t('collections.music.beatmapsPlayed')">
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(summary.beatmapsPlayed)
              }}<span class="text-sm text-text-muted"> / {{ formatNumber(summary.beatmaps) }}</span>
            </span>
          </template>
        </UiStat>
      </li>
      <li class="flex min-w-0">
        <UiStat :label="$t('collections.music.rewards')">
          <template #icon><Gift class="size-3.5" aria-hidden="true" /></template>
          <template #value>
            <span class="tabular truncate font-mono text-lg font-medium sm:text-xl">
              {{ formatNumber(summary.rewardsClaimed)
              }}<span class="text-sm text-text-muted"> / {{ formatNumber(summary.rewards) }}</span>
            </span>
          </template>
          <UiProgress
            class="mt-1"
            :value="summary.rewardsClaimed"
            :max="summary.rewards"
            :label="$t('collections.music.rewards')"
          />
        </UiStat>
      </li>
      <li class="flex min-w-0">
        <UiStat
          :label="$t('collections.music.rewardsLeft')"
          :value="summary.rewardsLeft"
          exact
          :tone="summary.rewardsLeft ? 'warning' : undefined"
          :hint="$t('collections.music.rewardsLeftHint')"
        >
          <template #icon><Gift class="size-3.5" aria-hidden="true" /></template>
        </UiStat>
      </li>
    </ul>

    <UiPanel :title="$t('collections.music.songs')" flush sticky>
      <template #actions>
        <label class="relative min-w-0 basis-full sm:w-72 sm:basis-auto">
          <span class="sr-only">{{ $t('collections.music.search') }}</span>
          <Search
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          />
          <UiInput
            v-model="search"
            type="search"
            class="pl-9"
            :placeholder="$t('collections.music.search')"
            autocomplete="off"
          />
        </label>
        <div class="scroll-hide scroll-fade-x flex max-w-full overflow-x-auto">
          <UiSegmented
            v-model="filter"
            :options="options"
            :label="$t('collections.archive.show')"
          />
        </div>
        <UiSelect
          v-model="sort"
          :options="sorts"
          class="w-40"
          :aria-label="$t('collections.music.sortLabel')"
        />
      </template>

      <div class="p-3 sm:p-5">
        <ul
          v-if="shown.length"
          class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-2"
          :aria-label="$t('collections.music.songs')"
        >
          <li
            v-for="song in shown"
            :key="song.id"
            class="song relative isolate flex min-w-0 flex-col gap-3 overflow-hidden rounded-md border p-3 [content-visibility:auto] [contain-intrinsic-size:auto_9rem]"
            :class="
              song.played
                ? 'border-transparent bg-surface-sunken'
                : 'unplayed border-dashed border-border-strong'
            "
          >
            <!-- The song's own cover washed over the card's top-right corner (design "Card B") -->
            <img
              v-if="cover(song.icon)"
              class="art"
              :src="cover(song.icon)"
              alt=""
              loading="lazy"
              aria-hidden="true"
            />
            <div class="flex min-w-0 items-center gap-3">
              <img
                v-if="cover(song.icon)"
                :src="cover(song.icon)"
                alt=""
                loading="lazy"
                class="size-14 flex-none rounded-full object-cover"
                :class="song.played ? '' : 'opacity-50 grayscale'"
              />
              <span v-else class="size-14 flex-none rounded-full bg-surface-overlay" />
              <span class="flex min-w-0 flex-col">
                <span
                  class="song-text truncate font-semibold"
                  :class="song.played ? 'text-text-primary' : 'text-text-secondary'"
                  :title="song.name"
                  >{{ song.name }}</span
                >
                <span v-if="song.artist" class="song-text truncate text-xs text-text-muted">{{
                  song.artist
                }}</span>
              </span>
            </div>
            <ul class="grid grid-cols-4 gap-1.5">
              <li
                v-for="b in song.beatmaps"
                :key="b.id"
                class="flex min-w-0 flex-col gap-0.5 rounded-md border px-2 py-1.5"
                :class="
                  !b.played
                    ? 'border-dashed border-border-strong'
                    : b.rewarded && !b.claimed
                      ? 'border-warning-text/60 bg-surface-raised'
                      : 'score'
                "
                :title="boxTitle(b)"
              >
                <span class="flex items-center justify-between gap-1 text-xs">
                  <span
                    class="truncate"
                    :class="
                      b.played && b.rewarded && !b.claimed ? 'text-warning-text' : 'text-text-muted'
                    "
                    >{{ difficulty(b.difficulty) }}</span
                  >
                  <Check
                    v-if="b.rewarded && b.claimed"
                    class="size-3.5 flex-none text-success-text"
                    aria-hidden="true"
                  />
                  <Gift
                    v-else-if="b.rewarded && b.played"
                    class="size-3.5 flex-none text-warning-text"
                    aria-hidden="true"
                  />
                </span>
                <span
                  class="tabular truncate font-mono text-sm font-medium"
                  :class="
                    !b.played
                      ? 'text-text-muted'
                      : b.rewarded && !b.claimed
                        ? 'text-warning-text'
                        : 'text-text-primary'
                  "
                  >{{ b.played ? formatNumber(b.score ?? 0) : '—' }}</span
                >
              </li>
            </ul>
          </li>
        </ul>
        <UiEmpty v-else :title="$t('collections.handbook.noneShown')">
          <template #icon><SearchX aria-hidden="true" /></template>
        </UiEmpty>
      </div>
    </UiPanel>
  </div>
</template>

<style scoped>
/* Design "Card B": the cover, blurred, fills the top-right corner and fades out
   toward the bottom-left, so the name and the score boxes sit on the card's
   own colour. No backdrop-filter (it repaints on every scroll frame). */
.song .art {
  position: absolute;
  z-index: -1;
  /* The cover is round: a square wider than the card's diagonal keeps its edge outside the card. */
  top: 50%;
  left: 50%;
  width: 125%;
  aspect-ratio: 1;
  max-width: none;
  transform: translate(-50%, -50%);
  object-fit: cover;
  pointer-events: none;
  filter: blur(5px) saturate(1.2);
  opacity: 0.5;
  mask-image: linear-gradient(250deg, #000 12%, rgba(0, 0, 0, 0.45) 42%, transparent 72%);
}
[data-theme='dark'] .song .art {
  filter: blur(5px) saturate(1.35);
  opacity: 0.6;
}
.song.unplayed .art {
  filter: grayscale(1) blur(5px);
  opacity: 0.2;
}
.song-text {
  text-shadow: 0 0 12px color-mix(in srgb, var(--surface-sunken) 90%, transparent);
}
.score {
  background: color-mix(in srgb, var(--surface-raised) 88%, transparent);
  border-color: color-mix(in srgb, var(--border-default) 80%, transparent);
}
</style>
