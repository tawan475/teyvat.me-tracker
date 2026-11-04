<script setup lang="ts">
import { computed, ref } from 'vue'
import type { EventBanner, PullRow } from '@/data/wish-history'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { bannerArt, bannerCardNumbers } from './banner-card'
import { OUTCOME_STYLE, outcomeLabel } from './wish-labels'

/**
 * An opened banner's numbers (paimon.moe's banner popup, the user's ask):
 * the banner's official art (both banners of a double run), the wishes made
 * on it and what they were worth, the rarity table (5★, 4★ by characters
 * and weapons: count, share of the run, average pity) and the 5★ 50/50s.
 * (Sharing it as a card is the row's button, WishBannerHistory.)
 */
const props = defineProps<{
  banner: EventBanner
  pulls: readonly PullRow[]
  rolls: ReadonlyMap<PullRow, number>
}>()

const numbers = computed(() => bannerCardNumbers(props.pulls, props.rolls))
const arts = computed(() => {
  const b = props.banner
  const second = b.kind === 'character' && b.name400
  return [
    { src: bannerArt(b), alt: b.kind === 'weapon' ? t('wishes.banners.weapon.title') : b.name },
    ...(second ? [{ src: bannerArt(b, true), alt: b.name400 }] : []),
  ]
})
/** Art that failed to load (a banner the CDN doesn't have yet) is left out. */
const failed = ref<ReadonlySet<string>>(new Set())
const fail = (src: string) => (failed.value = new Set([...failed.value, src]))

const pct = (share: number) => `${(share * 100).toFixed(1)}%`
const avg = (n: number, count: number) => (count ? n.toFixed(1) : '—')
const rows = computed(() => {
  const n = numbers.value
  return [
    { label: '5★', class: 'font-semibold text-rarity-5', row: n.five, sub: false },
    { label: '4★', class: 'font-semibold text-rarity-4', row: n.four, sub: false },
    {
      label: t('wishes.table.character'),
      class: 'text-text-secondary',
      row: n.fourCharacter,
      sub: true,
    },
    { label: t('wishes.table.weapon'), class: 'text-text-secondary', row: n.fourWeapon, sub: true },
  ]
})
const OUTCOMES = ['won', 'lost', 'guaranteed', 'radiance'] as const
</script>

<template>
  <div class="flex flex-wrap gap-4">
    <div class="flex min-w-0 flex-[1_1_22rem] flex-wrap gap-3">
      <template v-for="art in arts" :key="art.src">
        <!-- The art opens in its own tab (the user's ask, 2026-11-04). -->
        <a
          v-if="!failed.has(art.src)"
          :href="art.src"
          target="_blank"
          rel="noopener"
          :title="art.alt"
          class="aspect-[16/9] min-w-0 flex-[1_1_16rem] overflow-hidden rounded-xl shadow-sm"
        >
          <img
            :src="art.src"
            :alt="art.alt"
            class="size-full object-cover"
            @error="fail(art.src)"
          />
        </a>
      </template>
    </div>
    <div class="flex min-w-0 flex-[1_1_20rem] flex-col gap-3">
      <div class="flex flex-wrap items-end gap-x-6 gap-y-2">
        <span class="flex flex-col">
          <span class="text-xs text-text-muted">{{ $t('wishes.share.wishes') }}</span>
          <span class="tabular font-mono text-2xl font-bold">{{
            formatNumber(numbers.wishes)
          }}</span>
        </span>
        <span class="flex flex-col">
          <span class="text-xs text-text-muted">{{ $t('wishes.share.worth') }}</span>
          <span class="tabular font-mono text-2xl font-bold"
            >{{ formatNumber(numbers.wishes * 160)
            }}<span class="ml-1 text-base text-rarity-4" aria-hidden="true">✦</span></span
          >
        </span>
      </div>
      <table class="tabular w-full font-mono text-sm">
        <thead>
          <tr class="text-left text-xs text-text-muted">
            <th scope="col" class="py-1 font-sans font-medium">{{ $t('wishes.rarity') }}</th>
            <th scope="col" class="py-1 text-right font-sans font-medium">
              {{ $t('wishes.share.total') }}
            </th>
            <th scope="col" class="py-1 text-right font-sans font-medium">
              {{ $t('wishes.share.share') }}
            </th>
            <th scope="col" class="py-1 text-right font-sans font-medium">
              {{ $t('wishes.share.avgPity') }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.label" class="border-t border-border-default">
            <td class="py-1.5 font-sans" :class="[r.class, r.sub ? 'pl-4 text-xs' : '']">
              <span v-if="r.sub" aria-hidden="true">└ </span>{{ r.label }}
            </td>
            <td class="py-1.5 text-right" :class="r.sub ? 'text-text-secondary' : r.class">
              {{ formatNumber(r.row.count) }}
            </td>
            <td class="py-1.5 text-right" :class="r.sub ? 'text-text-secondary' : ''">
              {{ pct(r.row.share) }}
            </td>
            <td class="py-1.5 text-right" :class="r.sub ? 'text-text-secondary' : ''">
              {{ avg(r.row.avgPity, r.row.count) }}
            </td>
          </tr>
        </tbody>
      </table>
      <div
        v-if="OUTCOMES.some((o) => numbers.outcomes[o])"
        class="tabular flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm"
      >
        <span v-for="o in OUTCOMES" :key="o" :class="OUTCOME_STYLE[o].text" :title="outcomeLabel(o)"
          >{{ OUTCOME_STYLE[o].mark }} {{ numbers.outcomes[o] }}
          <span class="font-sans text-xs text-text-secondary">{{ outcomeLabel(o) }}</span></span
        >
      </div>
    </div>
  </div>
</template>
