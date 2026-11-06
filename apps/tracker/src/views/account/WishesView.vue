<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowDownUp, Clock, Sparkles } from 'lucide-vue-next'
import type { UigfGachaType } from '@gdt/shared'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiStat from '@/components/ui/UiStat.vue'
import WishBannerCard from '@/components/wishes/WishBannerCard.vue'
import WishBannerHistory from '@/components/wishes/WishBannerHistory.vue'
import WishBargains from '@/components/wishes/WishBargains.vue'
import WishMonthChart from '@/components/wishes/WishMonthChart.vue'
import WishTransferDialog from '@/components/wishes/WishTransferDialog.vue'
import { useWishHistory } from '@/components/wishes/use-wish-history'
import { useWishStats } from '@/components/wishes/use-wish-stats'
import { WISH_BANNERS, bannerInfo, formatPity, wishMinute } from '@/components/wishes/wish-labels'
import { EXPECTED_PITY, PRIMOS_PER_PULL, monthlyPulls, type BannerStats } from '@/data/wish-history'
import { t } from '@/i18n'
import { formatNumber } from '@/lib/format'
import { loadLatestInventory } from '@/data/account-data'
import { useResource } from '@/data/use-resource'
import { useAccount, useAccountRoute, useDemo, useReadOnly } from './context'

/**
 * Wish history overview: a card per banner (lifetime pulls, 5★ pity with
 * the next 5★'s odds and the way to hard pity, 4★ pity; the chevron folds
 * out the latest pulls below the card), pulls per month by rarity beside
 * what every wish was worth and the Character Event's average 5★ pity. Each
 * banner's page lists every pull. (The per-banner summaries that followed —
 * Character and Weapon with every 5★ as tiles, Standard and Chronicled
 * smaller — are commented out since 2026-11-05: a user found them confusing
 * and the user agreed; the numbers live on the banner pages.)
 * History arrives from irminsul (Wish → History opened in game, once a
 * day) or a UIGF / paimon.moe file; live events re-read it.
 */
const account = useAccount()
/** The Epitomized Path, from the newest capture (Teyvat.me Capture reads it off the Wish screen). */
const capture = useResource(
  () => account.value,
  (a) => (a.latest ? loadLatestInventory(a) : Promise.resolve(null)),
)
const wishPath = computed(() => capture.data.value?.good.gi_tasks?.wishPath ?? null)
/** Paimon's Bargains, from the newest capture (Capture 1.17.2 reads it when the shop is opened). */
const bargains = computed(() => capture.data.value?.good.gi_tasks?.bargains)
const bag = computed(() => capture.data.value?.good.materials)
const readOnly = useReadOnly()
const demo = useDemo()
const wishes = useWishHistory(() => account.value.id)
const history = computed(() => wishes.history.value)
const { stats, error: statsError, reload: reloadStats } = useWishStats(history)

type Shown = { info: (typeof WISH_BANNERS)[number]; stats: BannerStats }
/** Banners with pulls; Beginners' only when used, as paimon.moe does. */
const shown = computed(() =>
  WISH_BANNERS.map((b) => ({ info: b, stats: stats.value?.get(b.banner) })).filter(
    (b): b is Shown => !!b.stats && (b.info.banner !== 100 || b.stats.total > 0),
  ),
)
// The commented-out summaries below split `shown` into rated (Character,
// Weapon) and plain (Standard, Chronicled, Beginners') banners:
// const rated = computed(() => shown.value.filter((b) => b.info.rated && b.stats.total > 0))
// const plain = computed(() => shown.value.filter((b) => !b.info.rated && b.stats.total > 0))
const accountRoute = useAccountRoute()
const detail = (banner: UigfGachaType) => ({
  name: accountRoute('account-wishes-banner'),
  params: { accountId: account.value.id, banner: bannerInfo(banner).slug },
})

const months = computed(() => (stats.value ? monthlyPulls([...stats.value.values()]) : []))

/** The Character Event's average 5★ pity against the expected one. */
const avgPity = computed(() => {
  const s = stats.value?.get(301)
  if (!s?.five.count) return null
  const expected = EXPECTED_PITY[301]
  const diff = Math.round((s.five.avgPity - expected) * 10) / 10
  return {
    value: formatPity(Math.round(s.five.avgPity * 100) / 100),
    sub: t('wishes.overview.avgPityVs', {
      diff: `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${formatPity(Math.abs(diff))}`,
      expected,
    }),
    tone: diff > 0 ? 'text-warning-text' : diff < 0 ? 'text-accent-text' : 'text-text-muted',
  }
})

/** The newest pull, game clock. */
const newest = computed(() => {
  const h = history.value
  if (!h) return null
  let time = -1
  for (const pulls of h.banners.values()) time = Math.max(time, pulls.at(-1)?.time ?? -1)
  return time < 0 ? null : wishMinute(time)
})

const ready = computed(() => !!history.value && !!stats.value)
const loadError = computed(() => wishes.error.value ?? statsError.value)
function retry() {
  if (wishes.error.value) void wishes.reload()
  if (statsError.value) void reloadStats()
}

const dialog = ref(false)

/**
 * Banner history follows on the same page (the user's call, 2026-11-06: no
 * tab to switch, the banners are seen at once). A run named in the URL
 * (`?run=`, the banner page's links) opens and scrolls into view there.
 */
const route = useRoute()
const openRun = computed(() => (typeof route.query.run === 'string' ? route.query.run : null))
</script>

<template>
  <div>
    <PageHeader :title="$t('wishes.title')">
      <template v-if="ready && history?.total" #meta>
        <p class="flex flex-wrap items-center gap-x-3.5 gap-y-2 text-text-secondary">
          <span
            v-if="newest"
            class="flex items-center gap-2"
            :title="$t('wishes.overview.newestPull')"
          >
            <Clock class="size-4" aria-hidden="true" />
            <span class="tabular font-mono">{{ newest }}</span>
          </span>
        </p>
      </template>
      <template v-if="ready && history?.total" #actions>
        <UiButton size="sm" @click="dialog = true">
          <ArrowDownUp class="size-4" aria-hidden="true" />{{
            readOnly || demo ? $t('wishes.export') : $t('wishes.importExport')
          }}
        </UiButton>
      </template>
    </PageHeader>

    <UiError
      v-if="loadError && !ready"
      :title="$t('wishes.loadFailed')"
      :error="loadError"
      @retry="retry"
    />

    <template v-else-if="ready && history && stats">
      <UiPanel v-if="history.total === 0" flush>
        <div :title="$t('wishes.overview.syncHelp')">
          <UiEmpty :title="$t('wishes.overview.empty')" :body="$t('wishes.overview.emptyBody')">
            <template #icon><Sparkles aria-hidden="true" /></template>
            <UiButton v-if="!readOnly && !demo" variant="primary" @click="dialog = true">{{
              $t('wishes.import')
            }}</UiButton>
          </UiEmpty>
        </div>
      </UiPanel>
      <WishBargains
        v-if="history.total === 0 && capture.data.value"
        class="mt-4"
        :bargains="bargains"
        :materials="bag"
        :server="account.server"
        :now="Date.now()"
      />

      <div v-if="history.total > 0" class="flex flex-col gap-4">
        <!-- Cards stretch to the row's tallest; an open card's list hangs below it (absolute). -->
        <section
          :aria-label="$t('wishes.overview.banners')"
          class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14.5rem),1fr))] gap-3 sm:gap-3.5"
        >
          <WishBannerCard
            v-for="b in shown"
            :key="b.info.banner"
            :stats="b.stats"
            :to="detail(b.info.banner)"
            :path="b.info.banner === 302 ? wishPath : null"
          />
        </section>

        <div class="flex flex-wrap items-stretch gap-3.5">
          <WishMonthChart :months="months" class="min-w-0 flex-[999_1_640px]" />
          <section
            :aria-label="$t('wishes.overview.totals')"
            class="flex min-w-0 flex-[1_1_260px] flex-col gap-3.5"
          >
            <UiStat
              :label="$t('wishes.overview.worth')"
              :value="`✦ ${formatNumber(history.total * PRIMOS_PER_PULL)}`"
              :hint="
                $t('wishes.overview.worthHint', {
                  n: formatNumber(history.total),
                  primos: PRIMOS_PER_PULL,
                })
              "
              class="flex-1"
            >
              <span class="tabular font-mono text-xs text-text-muted">{{
                $t('wishes.overview.wishes', { n: formatNumber(history.total) })
              }}</span>
            </UiStat>
            <UiStat
              v-if="avgPity"
              :label="$t('wishes.overview.avgPity')"
              :value="avgPity.value"
              :hint="$t('wishes.overview.avgPityHint', { expected: EXPECTED_PITY[301] })"
              class="flex-1"
            >
              <span class="tabular font-mono text-xs" :class="avgPity.tone">{{ avgPity.sub }}</span>
            </UiStat>
          </section>
        </div>

        <WishBargains
          v-if="capture.data.value"
          :bargains="bargains"
          :materials="bag"
          :server="account.server"
          :now="Date.now()"
        />

        <!-- Per-banner summaries, off since 2026-11-05 (a user found them
             confusing; the banner pages carry the numbers). To bring them
             back: the imports, `rated` / `plain` above, and these two blocks.
        <WishBannerSummary
          v-for="b in rated"
          :key="b.info.banner"
          :stats="b.stats"
          :to="detail(b.info.banner)"
        />

        <div
          v-if="plain.length"
          class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,23rem),1fr))] items-start gap-3.5"
        >
          <WishSmallSummary
            v-for="b in plain"
            :key="b.info.banner"
            :stats="b.stats"
            :to="detail(b.info.banner)"
          />
        </div>
        -->
      </div>

      <section aria-labelledby="banner-history" class="mt-8 flex flex-col gap-3">
        <h2 id="banner-history" class="text-lg font-semibold text-text-primary">
          {{ $t('wishes.history.title') }}
        </h2>
        <WishBannerHistory
          :history="history"
          :stats="stats"
          :account="account"
          :player-uid="capture.data.value?.good.gi_player?.uid ?? null"
          :ar="capture.data.value?.good.gi_player?.ar ?? null"
          :open-run="openRun"
        />
      </section>
    </template>

    <div v-else aria-busy="true" :aria-label="$t('wishes.loading')" class="flex flex-col gap-4">
      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14.5rem),1fr))] gap-3.5">
        <UiSkeleton v-for="n in 4" :key="n" class="h-72" />
      </div>
      <UiSkeleton class="h-56" />
      <UiSkeleton class="h-80" />
    </div>

    <WishTransferDialog
      :open="dialog"
      :account="account"
      :history="history"
      :read-only="readOnly || demo"
      @close="dialog = false"
      @changed="wishes.refresh()"
    />
  </div>
</template>
