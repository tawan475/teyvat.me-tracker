<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import { Check, Info, Share2 } from 'lucide-vue-next'
import { achievementText, loadAchievements } from '@gdt/game-data'
import ArcanumArt from './ArcanumArt.vue'
import ArcanumDetail from './ArcanumDetail.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmpty from '@/components/ui/UiEmpty.vue'
import UiError from '@/components/ui/UiError.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { useAchievementMarks } from '@/components/achievements/use-achievement-marks'
import { NO_CAPTURED_ACHIEVEMENTS, loadCapturedAchievements } from '@/data/achievement-capture'
import { isDone } from '@/data/achievement-progress'
import { loadEndgameData, theaterDifficultyName } from '@/data/endgame'
import { loadCapturedEndgame, NO_CAPTURED_ENDGAME } from '@/data/endgame-capture'
import {
  ARCANA_FILTERS,
  MAGNUM_OPUS,
  arcanaSummary,
  arcanaViews,
  filterArcana,
  isMissing,
  type ArcanaFilter,
  type ArcanumView,
} from '@/data/lunar-arcana'
import { useResource } from '@/data/use-resource'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { giCdnArt } from '@/lib/assets'
import { formatDate, formatNumber } from '@/lib/format'
import { useAccount } from '@/views/account/context'
import { ARCANA_SKY } from './arcana-card'
import type { ArcanaDrawing } from './arcana-card-canvas'

const ArcanaShareModal = defineAsyncComponent(() => import('./ArcanaShareModal.vue'))
const SKY = giCdnArt(ARCANA_SKY)

/**
 * Lunar Arcana (Imaginarium Theater's Lunar Mode): the 22 cards, which the
 * account holds and how many of each (the newest capture's
 * `gi_endgame.theater.arcana`, Teyvat.me Capture 1.17.31 on), and the three
 * "Magnum Opus" achievements. The user's pick of 2026-11-18: A2's header
 * (Held, Spare, Magnum Opus tiles, a filter), B2's layout (small cards, the
 * last row centred, beside the picked card and its verse; a sheet on
 * phones), missing cards as their own art dark and blurred with the numeral
 * as the lock, and a share card, wide or tall. `?card=<number>` picks a card.
 */
const route = useRoute()
const router = useRouter()
const account = useAccount()
const wide = useMediaQuery('(min-width: 1024px)')

const game = useResource(
  () => locale.value,
  async (lang) => {
    const [endgame, achievements, text] = await Promise.all([
      loadEndgameData(lang),
      loadAchievements(),
      achievementText(lang),
    ])
    return { ...endgame, achievements, achievementText: text }
  },
)
const captured = useResource(
  () => account.value,
  async (a) => {
    const [endgame, achievements] = await Promise.all([
      a.latest ? loadCapturedEndgame(a) : NO_CAPTURED_ENDGAME,
      a.latest ? loadCapturedAchievements(a) : NO_CAPTURED_ACHIEVEMENTS,
    ])
    return { accountId: a.id, endgame, achievements }
  },
)
const marks = useAchievementMarks(() => account.value.id)

const arcana = computed(() => {
  const value = captured.data.value
  return value && value.accountId === account.value.id ? value.endgame.arcana : null
})
const views = computed<ArcanumView[]>(() =>
  arcanaViews(game.data.value?.data.arcana ?? [], arcana.value?.held ?? null),
)
const summary = computed(() => arcanaSummary(views.value))
const known = computed(() => summary.value.held !== null)

const text = (id: string, part: 'name' | 'title' | 'verse') =>
  game.data.value?.text.get(`arcanum.${id}.${part}`) ?? ''

const filter = ref<ArcanaFilter>('all')
watch([known, () => summary.value.spare], ([k, spare]) => {
  if (!k || (filter.value === 'spare' && !spare)) filter.value = 'all'
})
// Spare only while some card has copies to spare.
const filterOptions = computed(() =>
  ARCANA_FILTERS.filter((value) => value !== 'spare' || summary.value.spare > 0).map((value) => ({
    value,
    label: t(`collections.arcana.filters.${value}`),
    count:
      value === 'all'
        ? summary.value.total
        : value === 'held'
          ? (summary.value.held ?? 0)
          : value === 'missing'
            ? summary.value.total - (summary.value.held ?? 0)
            : summary.value.spares.length,
  })),
)
const shown = computed(() => filterArcana(views.value, filter.value))

/** The three Magnum Opus achievements: done (captured or marked by hand) and how far along. */
const opus = computed(() => {
  const value = captured.data.value
  const state = {
    captured: value?.accountId === account.value.id ? value.achievements.ids : new Set<number>(),
    marked: marks.loadedFor.value === account.value.id ? marks.marked.value : new Set<number>(),
  }
  const texts = game.data.value?.achievementText.achievements
  return MAGNUM_OPUS.map(({ id, need }) => ({
    id,
    need,
    done: isDone(state, id),
    title: texts?.get(id)?.title ?? '',
    description: texts?.get(id)?.description ?? '',
  }))
})
const opusTitle = computed(() => opus.value[0]?.title || '')

// The picked card: `?card=<number>`; on wide screens the first held card (else I) when none is.
const pickedNumber = computed(() => Number(route.query.card) || 0)
const picked = computed<ArcanumView | null>(() => {
  const found = views.value.find((v) => v.card.number === pickedNumber.value)
  if (found || !wide.value) return found ?? null
  return views.value.find((v) => (v.count ?? 0) > 0) ?? views.value[0] ?? null
})
function pick(number: number | null) {
  const next = { ...route.query }
  if (number) next.card = String(number)
  else delete next.card
  void router.replace({ query: next })
}
const sheetIndex = computed(() =>
  picked.value ? shown.value.findIndex((v) => v.card.number === picked.value!.card.number) : -1,
)
function step(delta: -1 | 1) {
  const list = shown.value
  if (!list.length) return
  const at = sheetIndex.value < 0 ? 0 : (sheetIndex.value + delta + list.length) % list.length
  pick(list[at]!.card.number)
}

const tileLabel = (v: ArcanumView) => {
  const name = text(v.card.id, 'name') || v.numeral
  if (v.count === null) return name
  if (v.count === 0) return `${name} · ${t('collections.arcana.stateMissing')}`
  return `${name} · ${
    v.count > 1
      ? t('collections.arcana.stateHeldN', { n: formatNumber(v.count) })
      : t('collections.arcana.stateHeld')
  }`
}

const subtitle = computed(() => {
  const data = game.data.value
  const lunar = data ? theaterDifficultyName(5, data.text) : ''
  return [t('endgame.modes.theater'), lunar].filter(Boolean).join(' · ')
})

const sharing = ref(false)
const shareOpened = ref(false)
const shareCard = computed<Omit<ArcanaDrawing, 'theme' | 'owner' | 'layout'> | null>(() => {
  if (!known.value || !arcana.value) return null
  return {
    cards: views.value.map((v) => ({
      icon: v.card.icon,
      numeral: v.numeral,
      title: text(v.card.id, 'title') || v.numeral,
      count: v.count ?? 0,
    })),
    held: summary.value.held ?? 0,
    spare: summary.value.spare,
    subtitle: subtitle.value,
    takenAt: arcana.value.takenAt,
  }
})
function share() {
  shareOpened.value = true
  sharing.value = true
}

const percent = computed(() =>
  summary.value.total && summary.value.held !== null
    ? Math.round((summary.value.held / summary.value.total) * 100)
    : 0,
)
/** Four, six or eight cards a row (phones, `sm`, `lg`); a short last row is centred. */
const TILE =
  'basis-[calc((100%-3*0.75rem)/4)] sm:basis-[calc((100%-5*0.75rem)/6)] lg:basis-[calc((100%-7*0.75rem)/8)]'
</script>

<template>
  <div class="flex flex-col gap-4">
    <UiError
      v-if="game.error.value && !game.data.value"
      :title="$t('collections.loadFailed')"
      :error="game.error.value"
      @retry="game.reload"
    />
    <template v-else>
      <!-- A2's header: Held, Spare, Magnum Opus, the filter; Share at the end. -->
      <div class="flex flex-wrap items-stretch gap-3">
        <div
          class="flex min-w-0 flex-[1_1_10rem] flex-col gap-2 rounded-xl border border-border-default bg-surface-raised px-4 py-3 shadow-sm"
          :title="$t('collections.arcana.heldHint')"
        >
          <span class="text-sm text-text-secondary">{{ $t('collections.arcana.held') }}</span>
          <span class="tabular font-mono text-2xl leading-none font-semibold">
            <template v-if="known">{{ formatNumber(summary.held ?? 0) }}</template>
            <template v-else>—</template>
            <span class="text-base font-normal text-text-muted">
              / {{ formatNumber(summary.total || 22) }}</span
            >
          </span>
          <div
            class="h-1.5 overflow-hidden rounded-full bg-surface-sunken"
            role="progressbar"
            :aria-valuenow="summary.held ?? undefined"
            :aria-valuemax="summary.total"
            :aria-label="$t('collections.arcana.held')"
          >
            <div class="h-full rounded-full bg-accent" :style="{ width: `${percent}%` }" />
          </div>
        </div>
        <div
          class="flex min-w-0 flex-[1_1_8rem] flex-col gap-2 rounded-xl border border-border-default bg-surface-raised px-4 py-3 shadow-sm"
          :title="$t('collections.arcana.spareHint')"
        >
          <span class="text-sm text-text-secondary">{{ $t('collections.arcana.spare') }}</span>
          <span class="tabular font-mono text-2xl leading-none font-semibold">{{
            known ? formatNumber(summary.spare) : '—'
          }}</span>
          <span v-if="summary.spares.length" class="truncate text-xs text-text-muted">{{
            summary.spares.map((v) => `${v.numeral} ×${v.count}`).join(' · ')
          }}</span>
        </div>
        <div
          class="flex min-w-0 flex-[999_1_20rem] flex-col gap-2 rounded-xl border border-border-default bg-surface-raised px-4 py-3 shadow-sm"
        >
          <span class="text-sm text-text-secondary">{{ opusTitle || '…' }}</span>
          <div class="flex flex-wrap gap-2">
            <span
              v-for="o in opus"
              :key="o.id"
              :title="`${o.title}: ${o.description}`"
              class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm"
              :class="
                o.done
                  ? 'border border-success-text font-semibold text-success-text'
                  : 'border border-dashed border-border-strong text-text-secondary'
              "
            >
              <Check v-if="o.done" class="size-4" aria-hidden="true" />
              {{
                o.need === 1
                  ? $t('collections.arcana.obtainOne')
                  : $t('collections.arcana.holdN', { n: o.need })
              }}
              <span v-if="!o.done && o.need > 1 && known" class="tabular font-mono text-text-muted"
                >{{ formatNumber(summary.held ?? 0) }}/{{ o.need }}</span
              >
            </span>
          </div>
        </div>
      </div>

      <!-- The capture's date (or the note it needs one), then the filter and Share on the same line. -->
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p
          v-if="captured.data.value && !known"
          class="mr-auto flex min-w-0 items-center gap-1.5 text-sm text-text-secondary"
        >
          <Info class="size-4 shrink-0" aria-hidden="true" />
          {{ $t('collections.arcana.needsCapture') }}
        </p>
        <p v-else class="mr-auto min-w-0 text-xs text-text-muted">
          <template v-if="arcana">{{
            $t('endgame.captured.fromCapture', { date: formatDate(arcana.takenAt) })
          }}</template>
        </p>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <UiSegmented
            v-if="known"
            v-model="filter"
            :options="filterOptions"
            :label="$t('collections.arcana.show')"
          />
          <UiButton
            variant="primary"
            :disabled="!shareCard"
            :title="shareCard ? undefined : $t('collections.arcana.needsCapture')"
            @click="share"
          >
            <Share2 class="size-4" aria-hidden="true" />{{ $t('share.export.share') }}
          </UiButton>
        </div>
      </div>

      <div
        v-if="!game.data.value"
        class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]"
        aria-busy="true"
      >
        <UiSkeleton class="h-96" />
        <UiSkeleton class="hidden h-96 lg:block" />
      </div>
      <UiEmpty v-else-if="!views.length" :title="$t('collections.arcana.noData')" />
      <!-- B2's layout: the cards, and the picked one read in full beside them. -->
      <div v-else class="flex flex-wrap items-start gap-4">
        <!-- On the game's Lunar Arcana sky, in the dark theme's colours whatever the page's. -->
        <div
          data-theme="dark"
          class="min-w-0 flex-[999_1_32rem] rounded-xl border border-border-default bg-[#070a1f] bg-cover bg-center p-3 shadow-sm sm:p-4"
          :style="{ backgroundImage: `url(${SKY})` }"
        >
          <UiEmpty v-if="!shown.length" :title="$t('collections.arcana.noneShown')" />
          <ul v-else class="flex flex-wrap justify-center gap-x-3 gap-y-4">
            <li v-for="v in shown" :key="v.card.id" class="min-w-0 grow-0" :class="TILE">
              <button
                type="button"
                class="group flex w-full min-w-0 flex-col items-center gap-1.5 rounded-lg p-0.5 focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                :aria-label="tileLabel(v)"
                :aria-pressed="wide ? picked?.card.number === v.card.number : undefined"
                :title="tileLabel(v)"
                @click="pick(v.card.number)"
              >
                <span
                  class="block w-full rounded-[9%/3.5%] outline-offset-[3px] transition-transform group-hover:-translate-y-0.5"
                  :class="
                    wide && picked?.card.number === v.card.number
                      ? 'outline-[3px] outline-accent-text outline-solid'
                      : ''
                  "
                >
                  <ArcanumArt
                    :src="giCdnArt(v.card.icon)"
                    :numeral="v.numeral"
                    :missing="isMissing(v)"
                    :count="v.count"
                  />
                </span>
                <span
                  class="tabular text-xs"
                  :class="[
                    wide && picked?.card.number === v.card.number
                      ? 'font-semibold text-accent-text'
                      : isMissing(v)
                        ? 'text-text-muted'
                        : 'font-semibold text-text-primary',
                  ]"
                  >{{ v.numeral }}</span
                >
              </button>
            </li>
          </ul>
        </div>
        <aside
          v-if="wide && picked"
          class="sticky top-20 min-w-0 flex-[1_1_22rem] overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-sm lg:max-w-[28rem]"
          :aria-label="text(picked.card.id, 'name')"
        >
          <ArcanumDetail
            :view="picked"
            :name="text(picked.card.id, 'name')"
            :title="text(picked.card.id, 'title') || picked.numeral"
            :verse="text(picked.card.id, 'verse')"
          />
        </aside>
      </div>
    </template>

    <!-- Phones and tablets: the picked card in a sheet, stepping through the cards shown. -->
    <UiModal
      v-if="!wide"
      :open="!!picked"
      :title="picked ? text(picked.card.id, 'title') || picked.numeral : ''"
      sheet
      :index="sheetIndex >= 0 ? sheetIndex : undefined"
      :total="sheetIndex >= 0 ? shown.length : undefined"
      loop
      @step="step"
      @close="pick(null)"
    >
      <ArcanumDetail
        v-if="picked"
        class="-mx-5 -my-4"
        :view="picked"
        :name="text(picked.card.id, 'name')"
        :title="text(picked.card.id, 'title') || picked.numeral"
        :verse="text(picked.card.id, 'verse')"
      />
    </UiModal>

    <ArcanaShareModal
      v-if="shareOpened"
      :open="sharing"
      :card="shareCard"
      @close="sharing = false"
    />
  </div>
</template>
