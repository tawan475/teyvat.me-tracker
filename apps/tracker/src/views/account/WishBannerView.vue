<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import WishFiveGrid from '@/components/wishes/WishFiveGrid.vue'
import WishNumbers from '@/components/wishes/WishNumbers.vue'
import WishOddsChip from '@/components/wishes/WishOddsChip.vue'
import WishPityTrack from '@/components/wishes/WishPityTrack.vue'
import WishTable from '@/components/wishes/WishTable.vue'
import { useWishHistory } from '@/components/wishes/use-wish-history'
import { useWishStats } from '@/components/wishes/use-wish-stats'
import { WISH_BANNERS, bannerBySlug } from '@/components/wishes/wish-labels'
import { HARD_PITY, PRIMOS_PER_PULL, SOFT_PITY } from '@/data/wish-history'
import { formatNumber } from '@/lib/format'
import { useAccount, useAccountRoute } from './context'

/**
 * One banner's wish history: three tiles (lifetime pulls; the 5★ pity with
 * the next 5★'s odds and the way to hard pity; the 4★ pity), its numbers
 * (5★ and 4★, the 50/50s, the 4★ split), every 5★ as tiles, the banner runs
 * pulled on and every pull in a paged table. The switch moves between
 * banners in place.
 */
const account = useAccount()
const route = useRoute()
const router = useRouter()
const wishes = useWishHistory(() => account.value.id)
const history = computed(() => wishes.history.value)
const { stats: all, error: statsError, reload: reloadStats } = useWishStats(history)

const info = computed(() => bannerBySlug(route.params.banner) ?? WISH_BANNERS[0]!)
const stats = computed(() => all.value?.get(info.value.banner) ?? null)
const hard = computed(() => HARD_PITY[info.value.banner])
const soft = computed(() => SOFT_PITY[info.value.banner])
const left = computed(() => hard.value[0] - (stats.value?.pity5 ?? 0))

const accountRoute = useAccountRoute()
const banner = computed({
  get: () => info.value.slug,
  set: (slug: string) =>
    void router.replace({
      name: accountRoute('account-wishes-banner'),
      params: { ...route.params, banner: slug },
    }),
})
/** Banners with pulls (and this one), for the switch. */
const bannerOptions = computed(() =>
  WISH_BANNERS.filter(
    (b) => b.banner === info.value.banner || (all.value?.get(b.banner)?.total ?? 0) > 0,
  ).map((b) => ({ value: b.slug, label: b.label, title: b.title })),
)

const TILE =
  'flex min-w-0 flex-col gap-2.5 rounded-xl border border-border-default bg-surface-raised px-4 py-4 shadow-sm sm:px-4.5'

const ready = computed(() => !!stats.value)
const loadError = computed(() => wishes.error.value ?? statsError.value)
function retry() {
  if (wishes.error.value) void wishes.reload()
  if (statsError.value) void reloadStats()
}
</script>

<template>
  <div>
    <PageHeader :title="$t('wishes.bannerPageTitle', { banner: info.title })" />

    <div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-3">
      <UiIconButton
        :label="$t('wishes.title')"
        :to="{ name: accountRoute('account-wishes'), params: { accountId: account.id } }"
      >
        <ArrowLeft class="size-5" aria-hidden="true" />
      </UiIconButton>
      <h2 class="min-w-0 flex-1 truncate text-lg font-semibold">{{ info.title }}</h2>
      <div
        v-if="bannerOptions.length > 1"
        class="scroll-hide scroll-fade-x max-w-full min-w-0 overflow-x-auto sm:scroll-fade-none"
      >
        <UiSegmented v-model="banner" :options="bannerOptions" :label="$t('wishes.banner')" />
      </div>
    </div>

    <UiError
      v-if="loadError && !ready"
      :title="$t('wishes.loadFailed')"
      :error="loadError"
      @retry="retry"
    />

    <template v-else-if="stats">
      <UiPanel v-if="stats.total === 0" flush>
        <UiEmpty :title="$t('wishes.bannerPage.noPulls')" />
      </UiPanel>

      <div v-else class="flex flex-col gap-4">
        <section
          :aria-label="$t('wishes.bannerPage.now')"
          class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15.5rem),1fr))] gap-3 sm:gap-3.5"
        >
          <div
            :class="TILE"
            class="justify-center gap-1.5!"
            :title="
              $t('wishes.pullsTimes', { n: formatNumber(stats.total), primos: PRIMOS_PER_PULL })
            "
          >
            <span class="text-xs text-text-secondary">{{ $t('wishes.lifetime') }}</span>
            <span class="tabular font-mono text-[2rem] leading-none font-bold">{{
              formatNumber(stats.total)
            }}</span>
            <span class="tabular font-mono text-xs text-text-muted"
              >✦ {{ formatNumber(stats.total * PRIMOS_PER_PULL) }}</span
            >
          </div>

          <div
            :class="TILE"
            :title="
              $t('wishes.bannerPage.hardTitle', {
                left: formatNumber(left),
                primos: formatNumber(left * PRIMOS_PER_PULL),
              })
            "
          >
            <div class="flex min-w-0 items-center gap-2.5">
              <span class="flex min-w-0 flex-col">
                <span class="truncate text-xs text-text-secondary">{{
                  $t('wishes.card.pity5')
                }}</span>
                <span class="truncate text-xs text-text-muted">{{
                  $t('wishes.card.guaranteedAt', { n: hard[0] })
                }}</span>
              </span>
              <WishOddsChip :stats="stats" class="ml-auto" />
              <span
                class="tabular font-mono text-[2rem] leading-none font-bold text-rarity-5"
                :class="stats.guaranteed5 === null ? 'ml-auto' : ''"
                >{{ stats.pity5 }}</span
              >
            </div>
            <WishPityTrack :pity="stats.pity5" :hard="hard[0]" :soft="soft" />
            <div
              class="tabular flex flex-wrap justify-between gap-x-3 font-mono text-xs text-text-muted"
            >
              <span>{{
                $t('wishes.bannerPage.toHard', {
                  left: formatNumber(left),
                  primos: formatNumber(left * PRIMOS_PER_PULL),
                })
              }}</span>
              <span class="text-warning-text">{{
                $t('wishes.bannerPage.softFrom', { soft })
              }}</span>
            </div>
          </div>

          <div :class="TILE">
            <div class="flex min-w-0 items-center gap-2.5">
              <span class="flex min-w-0 flex-col">
                <span class="truncate text-xs text-text-secondary">{{
                  $t('wishes.card.pity4')
                }}</span>
                <span class="truncate text-xs text-text-muted">{{
                  $t('wishes.card.guaranteedAt', { n: hard[1] })
                }}</span>
              </span>
              <span
                v-if="stats.guaranteed4"
                class="ml-auto inline-flex shrink-0 items-center rounded-full border border-accent-text bg-accent/15 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-accent-text"
                :title="$t('wishes.bannerPage.featuredNextTitle')"
                >{{ $t('wishes.bannerPage.featuredNext') }}</span
              >
              <span
                class="tabular font-mono text-[2rem] leading-none font-bold text-rarity-4"
                :class="stats.guaranteed4 ? '' : 'ml-auto'"
                >{{ stats.pity4 }}</span
              >
            </div>
            <div class="h-2.5 overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
              <div
                class="h-full rounded-full bg-rarity-4"
                :style="{ width: `${Math.min(100, (stats.pity4 / hard[1]) * 100)}%` }"
              />
            </div>
            <span class="tabular font-mono text-xs text-text-muted">{{
              $t('wishes.bannerPage.toGuaranteed4', { n: hard[1] - stats.pity4 })
            }}</span>
          </div>
        </section>

        <WishNumbers :stats="stats" />

        <section
          :aria-label="$t('wishes.five.every')"
          class="min-w-0 rounded-xl border border-border-default bg-surface-raised px-4 pt-3.5 pb-4 shadow-sm sm:px-5"
        >
          <WishFiveGrid :stats="stats" dated box-class="max-h-[30rem]" />
        </section>

        <WishTable :rows="stats.rows" :banner="stats.banner" />
      </div>
    </template>

    <div v-else aria-busy="true" :aria-label="$t('wishes.loading')" class="flex flex-col gap-4">
      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15.5rem),1fr))] gap-3.5">
        <UiSkeleton v-for="n in 3" :key="n" class="h-32" />
      </div>
      <UiSkeleton class="h-36" />
      <UiSkeleton class="h-96" />
    </div>
  </div>
</template>
