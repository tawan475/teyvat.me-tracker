<script setup lang="ts">
import { computed, defineAsyncComponent, ref, shallowRef, watch } from 'vue'
import type { AbyssPeriod } from '@gdt/game-data/endgame'
import { Share2, Zap } from 'lucide-vue-next'
import GameText from '@/components/game/GameText.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { gameRuns, type EndgameData } from '@/data/endgame'
import type { CapturedAbyss, CapturedAbyssRecord } from '@/data/endgame-capture'
import { abyssArt, abyssArtFailed, characterIcon } from '@/lib/assets'
import { formatDate, formatNumber } from '@/lib/format'
import { characterName } from '@/i18n/game-names'
import { t } from '@/i18n'
import EndgameStar from './EndgameStar.vue'
import EnemyTile from './EnemyTile.vue'

/**
 * A Spiral Abyss period: the blessing on its art, then one floor at a time
 * (Floor 12 first, the one that matters): its Ley Line Disorders and three
 * chambers, each half's enemies with their HP at the chamber's level. With a
 * capture of this period (`run`: gi_tasks.abyss at a login) the header says
 * the account's stars; with the record book (`record`: gi_endgame.abyss,
 * Capture 1.17.21, when the Challenge Summary was opened) the record moves
 * into the hero (the user's pick "C", 2026-11-07, without borders and
 * gathered round the centre): the stars (the game's own star), the deepest
 * descent, the characters picked most and Share on a card over the art
 * (under it on narrower screens), and the five figures as one centred group
 * under the blessing text, a divider between them from lg. Share opens the
 * record's PNG card (RecordShareModal).
 */
const props = defineProps<{
  season: AbyssPeriod
  data: EndgameData
  name: string
  period: string
  left: number
  run?: CapturedAbyss | null
  record?: CapturedAbyssRecord | null
}>()
defineEmits<{
  /** An enemy to open, at its level, with its HP in this fight (0 unknown; `before`: before the bonus). */
  enemy: [codex: number, level: number, hp: number, before?: boolean]
}>()

const text = computed(() => props.data.text)
const sprite = (id: number) => text.value.get(`sprite.${id}`)
/** The account's stars this period, as the capture counted them (shown when there is no record). */
const yourRun = computed(() =>
  props.run && !props.record
    ? {
        n: props.run.run.stars,
        total: props.run.run.maxStars,
        stars: t('endgame.captured.stars', {
          n: props.run.run.stars,
          total: props.run.run.maxStars,
        }),
        from: t('endgame.captured.fromCapture', { date: formatDate(props.run.takenAt) }),
      }
    : null,
)
/** The period's record, laid out for the card. */
const yourRecord = computed(() => {
  if (!props.record) return null
  const r = props.record.record
  const figures = (
    [
      ['defeats', t('endgame.captured.defeats')],
      ['strike', t('endgame.share.strike')],
      ['damageTaken', t('endgame.captured.damageTaken')],
      ['skills', t('endgame.captured.skills')],
      ['bursts', t('endgame.captured.bursts')],
    ] as const
  ).flatMap(([key, label]) => {
    const figure = r[key]
    if (!figure) return []
    const by = figure.by ? characterName(figure.by) : ''
    return [
      {
        key,
        label,
        value: formatNumber(figure.value),
        by: figure.by ?? '',
        byName: by,
        title: `${label}: ${formatNumber(figure.value)}${by ? ` · ${by}` : ''}`,
      },
    ]
  })
  const total = props.season.floors.length * 9
  return {
    deepest: `${t('endgame.abyss.floor', { n: r.floor })} · ${t('endgame.abyss.chamber', { n: r.chamber })}`,
    stars: r.stars,
    total,
    starsTitle: total
      ? t('endgame.captured.stars', { n: r.stars, total })
      : t('endgame.captured.starsN', { n: r.stars }),
    from: t('endgame.captured.fromCapture', { date: formatDate(props.record.takenAt) }),
    figures,
    picked: r.picked.map((p) => ({
      key: p.key,
      name: characterName(p.key),
      times: p.times,
      title: `${characterName(p.key)} · ×${p.times}`,
    })),
  }
})
/** The blessing's text without its colour runs and icons (the share card's). */
const blessingText = computed(() =>
  gameRuns(text.value.get(`abyss.${props.season.id}.desc`))
    .map((line) =>
      line.map((r) => (r.sprite !== undefined ? (sprite(r.sprite) ?? '') : r.text)).join(''),
    )
    .join(' '),
)
const RecordShareModal = defineAsyncComponent(() => import('./RecordShareModal.vue'))
const shareOpened = ref(false)
const sharing = shallowRef(false)
const shareCard = computed(() =>
  props.record
    ? {
        mode: 'abyss' as const,
        input: {
          record: props.record.record,
          total: props.season.floors.length * 9,
          seasonName: props.name,
          start: props.season.start,
          end: props.season.end,
          takenAt: props.record.takenAt,
          blessing: {
            art: abyssArt(props.season.icon),
            label: t('endgame.abyss.blessing'),
            text: blessingText.value,
          },
        },
      }
    : null,
)
function share() {
  shareOpened.value = true
  sharing.value = true
}

const floorNo = ref(0)
watch(
  () => props.season.id,
  () => (floorNo.value = props.season.floors.at(-1)?.floor ?? 0),
  { immediate: true },
)
const floorOptions = computed(() =>
  props.season.floors.map((f) => ({
    value: f.floor,
    label: t('endgame.abyss.floor', { n: f.floor }),
    title: t('endgame.levels', {
      from: f.chambers[0]?.level ?? 0,
      to: f.chambers.at(-1)?.level ?? 0,
    }),
  })),
)
const floor = computed(() => props.season.floors.find((f) => f.floor === floorNo.value) ?? null)
const chambers = computed(() =>
  (floor.value?.chambers ?? []).map((c) => ({
    ...c,
    halves: c.halves.map((half) =>
      half.map((e) => {
        const level = e.level || c.level
        return {
          ...e,
          level,
          monster: props.data.data.monsters.get(e.monster),
          name: text.value.get(`monster.${e.monster}`),
        }
      }),
    ),
  })),
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <section
      class="relative overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-sm"
    >
      <div class="relative h-44 bg-surface-sunken sm:h-56">
        <img
          :src="abyssArt(season.icon)"
          alt=""
          class="absolute inset-0 size-full object-cover"
          @error="abyssArtFailed"
        />
        <span
          class="absolute inset-0 bg-linear-to-r from-surface-base/95 via-surface-base/55 to-surface-base/30"
        />
        <div class="absolute bottom-4 left-4 flex max-w-xl flex-col gap-1.5 sm:bottom-6 sm:left-6">
          <span class="text-xs font-semibold tracking-wide text-accent-text uppercase">{{
            $t('endgame.abyss.blessing')
          }}</span>
          <h2 class="text-2xl font-bold sm:text-3xl">{{ name }}</h2>
          <span class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span class="tabular font-mono text-text-secondary">{{ period }}</span>
            <span v-if="left > 0" class="font-semibold text-success-text">{{
              $t('endgame.activeLeft', { n: left }, left)
            }}</span>
          </span>
          <span
            v-if="yourRun"
            class="mt-1 flex w-fit items-baseline gap-2 rounded-lg border border-border-default bg-surface-sunken/90 px-3 py-1.5"
            :title="yourRun.from"
          >
            <span class="text-xs font-semibold tracking-wide text-text-muted uppercase">{{
              $t('endgame.captured.run')
            }}</span>
            <span
              class="tabular inline-flex items-center gap-1 self-center font-mono text-sm font-semibold"
              :aria-label="yourRun.stars"
            >
              <EndgameStar kind="abyss" :size="15" />{{ yourRun.n
              }}<span class="font-normal text-text-muted">/{{ yourRun.total }}</span>
            </span>
          </span>
        </div>
      </div>

      <!-- The period's record (Capture 1.17.21's record book): on the art from lg, under it below. -->
      <div
        v-if="yourRecord"
        class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 border-b border-border-default px-4 py-3 sm:px-6 lg:absolute lg:top-56 lg:right-5 lg:min-w-80 lg:-translate-y-[calc(100%+1.25rem)] lg:rounded-xl lg:border-b-0 lg:bg-surface-raised/95 lg:px-4.5 lg:py-3.5 lg:shadow-overlay"
        :title="yourRecord.from"
      >
        <h3 class="text-xs font-semibold tracking-wide text-text-muted uppercase">
          {{ $t('endgame.captured.record') }}
        </h3>
        <UiButton
          size="sm"
          class="justify-self-end"
          :title="$t('endgame.share.title')"
          @click="share"
        >
          <Share2 class="size-4" aria-hidden="true" />{{ $t('share.export.share') }}
        </UiButton>
        <span class="flex min-w-0 flex-col gap-1">
          <span class="flex items-center gap-1.5" :aria-label="yourRecord.starsTitle">
            <EndgameStar kind="abyss" :size="28" />
            <b class="tabular font-mono text-3xl leading-none font-extrabold">{{
              yourRecord.stars
            }}</b>
            <span v-if="yourRecord.total" class="tabular font-mono text-text-muted"
              >/ {{ yourRecord.total }}</span
            >
          </span>
          <span
            class="tabular font-mono text-sm font-semibold text-text-secondary"
            :title="$t('endgame.captured.deepest')"
            >{{ yourRecord.deepest }}</span
          >
        </span>
        <!-- Beside the stars from sm; under them, full width, on narrow phones. -->
        <ul
          v-if="yourRecord.picked.length"
          class="col-span-2 flex gap-2 sm:col-span-1 sm:justify-self-end"
          :aria-label="$t('endgame.captured.picked')"
        >
          <li
            v-for="p in yourRecord.picked"
            :key="p.key"
            class="relative size-10 shrink-0"
            :title="p.title"
          >
            <img
              :src="characterIcon(p.key)"
              :alt="p.name"
              loading="lazy"
              class="size-10 rounded-full border border-border-strong bg-surface-overlay object-cover"
            />
            <!-- How often: a count, not a colour. -->
            <span
              class="tabular absolute -right-1 -bottom-1 rounded-md border border-border-strong bg-surface-overlay px-1 font-mono text-[10px] leading-4 font-semibold"
              >×{{ p.times }}</span
            >
          </li>
        </ul>
      </div>

      <GameText
        :text="text.get(`abyss.${season.id}.desc`)"
        :sprites="data.data.sprites"
        :sprite-name="sprite"
        class="px-4 py-3.5 text-sm leading-relaxed text-text-secondary sm:px-6"
      />

      <!-- The five figures: one group in the middle, no borders between them. -->
      <template v-if="yourRecord?.figures.length">
        <hr class="mx-6 mb-3.5 hidden border-border-default lg:block" />
        <ul
          class="flex flex-wrap justify-center gap-x-7 gap-y-2.5 px-4 pb-4 sm:px-6 lg:gap-x-8 lg:pb-5"
          :aria-label="$t('endgame.captured.record')"
        >
          <li
            v-for="g in yourRecord.figures"
            :key="g.key"
            class="flex max-w-38 min-w-0 flex-col items-center gap-1 py-1 text-center sm:max-w-56"
            :title="g.title"
          >
            <span class="max-w-full truncate text-xs text-text-muted">{{ g.label }}</span>
            <b class="tabular font-mono text-lg leading-tight font-bold">{{ g.value }}</b>
            <span v-if="g.by" class="flex max-w-full min-w-0 items-center justify-center gap-1.5">
              <img
                :src="characterIcon(g.by)"
                alt=""
                loading="lazy"
                class="size-6.5 shrink-0 rounded-full border border-border-strong bg-surface-overlay object-cover"
              />
              <span class="truncate text-sm text-text-secondary">{{ g.byName }}</span>
            </span>
          </li>
        </ul>
      </template>
    </section>

    <div class="scroll-hide scroll-fade-x -mx-4 min-w-0 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <UiSegmented
        v-model="floorNo"
        :options="floorOptions"
        :label="$t('endgame.abyss.floors')"
        size="md"
      />
    </div>

    <ul
      v-if="floor?.disorders.length"
      class="flex flex-col gap-2"
      :aria-label="$t('endgame.abyss.disorder')"
    >
      <li
        v-for="d in floor.disorders"
        :key="d"
        class="flex items-start gap-2.5 rounded-lg border border-accent-text/35 bg-accent/10 px-3.5 py-2.5 text-sm leading-relaxed"
      >
        <Zap class="mt-0.5 size-4 shrink-0 text-accent-text" aria-hidden="true" />
        <GameText
          :text="text.get(`disorder.${d}`)"
          :sprites="data.data.sprites"
          :sprite-name="sprite"
        />
      </li>
    </ul>

    <div class="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
      <section
        v-for="chamber in chambers"
        :key="chamber.chamber"
        class="flex min-w-0 flex-col rounded-xl border border-border-default bg-surface-raised shadow-sm"
      >
        <header
          class="flex items-baseline justify-between gap-2 border-b border-border-default px-4 py-3"
        >
          <h3 class="text-base font-semibold">
            {{ $t('endgame.abyss.chamber', { n: chamber.chamber }) }}
          </h3>
          <span class="tabular font-mono text-xs text-text-muted">{{
            $t('endgame.level', { n: chamber.level })
          }}</span>
        </header>
        <div
          v-for="(half, h) in chamber.halves"
          :key="h"
          class="flex min-w-0 flex-col gap-2 px-3 py-3"
          :class="h > 0 ? 'border-t border-dashed border-border-default' : ''"
        >
          <span class="px-1 text-xs font-semibold tracking-wide text-text-muted uppercase">{{
            h ? $t('endgame.abyss.secondHalf') : $t('endgame.abyss.firstHalf')
          }}</span>
          <ul class="flex flex-wrap gap-1">
            <li v-for="(enemy, i) in half" :key="i">
              <EnemyTile
                :monster="enemy.monster"
                :name="enemy.name"
                :level="enemy.level"
                :hp="enemy.hp"
                @open="(codex, level, hp) => $emit('enemy', codex, level, hp)"
              />
            </li>
          </ul>
        </div>
      </section>
    </div>
    <RecordShareModal
      v-if="shareOpened"
      :open="sharing"
      :card="shareCard"
      @close="sharing = false"
    />
  </div>
</template>
