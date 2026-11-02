<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { ExternalLink } from 'lucide-vue-next'
import type { EndgameText, StygianSeason } from '@gdt/game-data/endgame'
import GameText from '@/components/game/GameText.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import BossPicture from './BossPicture.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import {
  loadEndgameData,
  stygianBossPicture,
  stygianHpTip as hpTip,
  type EndgameData,
} from '@/data/endgame'
import { formatShort } from '@/lib/format'
import { gameIcon } from '@/lib/assets'
import { STYGIAN_GROUND } from './modes'

/**
 * A Stygian Onslaught season: its difficulties as a scale (each with its
 * monster level; the hardest first chosen), then the three opponents. A
 * card's top (picture, name, HP at the chosen level, the characters the game
 * recommends, centred) is one button that opens the boss's Living Beings entry;
 * below it, its mechanics, numbered, and a link to the boss's community
 * clears on stygian.moe (a fan site, the users' ask; the header links the
 * site itself).
 */
const props = defineProps<{
  season: StygianSeason
  data: EndgameData
  name: string
  period: string
  left: number
}>()
defineEmits<{
  /** An enemy to open, at its level, with its HP in this fight (0 unknown; `before`: before the bonus). */
  enemy: [codex: number, level: number, hp: number, before?: boolean]
}>()

const text = computed(() => props.data.text)
const sprite = (id: number) => text.value.get(`sprite.${id}`)
const difficulty = ref(0)
watch(
  () => props.season.id,
  () => (difficulty.value = props.season.difficulties.at(-1)?.difficulty ?? 0),
  { immediate: true },
)
const chosen = computed(
  () => props.season.difficulties.find((d) => d.difficulty === difficulty.value) ?? null,
)
const range = (n: number) => Array.from({ length: n }, (_, i) => i)

const STYGIAN_MOE = 'https://www.stygian.moe/'
/** The English names: stygian.moe files clears under them, whatever the page's language. */
const english = shallowRef<EndgameText | null>(null)
loadEndgameData('en').then(
  (en) => (english.value = en.text),
  () => undefined,
)
/**
 * A boss's clears on stygian.moe, by position: the site keeps the hardest
 * difficulty's version of each boss (`?boss=` its English "Name: Title").
 */
function clearsUrl(index: number): string | null {
  const id = props.season.difficulties.at(-1)?.bosses[index]
  const name = id !== undefined ? english.value?.get(`stygianBoss.${id}.name`) : ''
  return name ? `${STYGIAN_MOE}clears?${new URLSearchParams({ boss: name })}` : null
}
const bosses = computed(() => {
  const level = chosen.value?.level ?? 0
  return (chosen.value?.bosses ?? []).flatMap((id, i) => {
    const boss = props.data.data.stygianBosses.get(id)
    if (!boss) return []
    const full = text.value.get(`stygianBoss.${id}.name`)
    const [short, ...title] = full.split(':')
    const hp = chosen.value?.hp[i] ?? 0
    return [
      {
        boss,
        full,
        short: short!.trim(),
        title: title.join(':').trim(),
        codex: props.data.data.monsters.get(boss.monster)?.codex ?? 0,
        level,
        hp,
        before: !!chosen.value?.beforeBonus[i],
        hpTip: hpTip(hp, level, !!chosen.value?.beforeBonus[i]),
        clears: clearsUrl(i),
      },
    ]
  })
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="flex min-w-0 flex-col gap-1">
        <h2 class="text-2xl font-bold sm:text-3xl">{{ name }}</h2>
        <span class="flex flex-wrap gap-x-3 text-sm">
          <span class="tabular font-mono text-text-muted">{{ period }}</span>
          <span v-if="left > 0" class="font-semibold text-success-text">{{
            $t('endgame.activeLeft', { n: left }, left)
          }}</span>
        </span>
      </div>
      <UiButton :href="STYGIAN_MOE" size="sm" :title="$t('endgame.stygian.siteTip')">
        stygian.moe
        <ExternalLink class="size-3.5" aria-hidden="true" />
      </UiButton>
    </div>

    <div
      role="radiogroup"
      :aria-label="$t('endgame.stygian.difficulty')"
      class="grid grid-cols-3 gap-1.5 sm:grid-cols-6"
    >
      <button
        v-for="d in season.difficulties"
        :key="d.difficulty"
        type="button"
        role="radio"
        :aria-checked="d.difficulty === difficulty"
        class="flex min-h-12 flex-col items-center justify-center rounded-lg border px-2 py-1.5 text-sm transition-colors"
        :class="
          d.difficulty === difficulty
            ? 'border-rarity-4 bg-surface-overlay font-semibold text-text-primary ring-1 ring-rarity-4'
            : 'border-border-default bg-surface-raised text-text-secondary hover:bg-surface-overlay'
        "
        @click="difficulty = d.difficulty"
      >
        <span class="truncate">{{
          text.get(`stygianDifficulty.${d.difficulty}`) || String(d.difficulty)
        }}</span>
        <span class="tabular font-mono text-xs font-normal text-text-muted">{{
          $t('endgame.level', { n: d.level })
        }}</span>
      </button>
    </div>

    <div class="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3">
      <article
        v-for="b in bosses"
        :key="b.boss.id"
        class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-sm"
      >
        <component
          :is="b.codex ? 'button' : 'div'"
          :type="b.codex ? 'button' : undefined"
          class="group flex flex-col text-center"
          :class="b.codex && 'transition-colors hover:bg-surface-overlay'"
          :title="b.codex ? b.full : `${b.full}\n${$t('endgame.noEntry')}`"
          @click="b.codex && $emit('enemy', b.codex, b.level, b.hp, b.before)"
        >
          <span class="flex h-48 items-end justify-center overflow-hidden" :class="STYGIAN_GROUND">
            <BossPicture
              :src="gameIcon(stygianBossPicture(b.boss).name)"
              :art="stygianBossPicture(b.boss).art"
              :name="b.full"
              class="h-full w-full transition-transform group-hover:scale-[1.03]"
            />
          </span>
          <span class="flex flex-col items-center gap-1 px-4 pt-3.5 pb-3">
            <span class="text-base leading-snug font-semibold">{{ b.short }}</span>
            <span v-if="b.title" class="text-sm text-warning-text">{{ b.title }}</span>
            <span class="mt-1 flex items-center justify-center gap-1.5" :title="b.hpTip">
              <span
                class="tabular font-mono text-sm font-semibold"
                :class="b.hp ? 'text-danger-text' : 'text-text-muted'"
                >♥ {{ b.hp ? formatShort(b.hp) : '—' }}</span
              >
              <UiBadge v-if="b.before">{{ $t('endgame.beforeBonus') }}</UiBadge>
            </span>
            <span
              v-if="b.boss.recommendations"
              class="mt-1.5 flex flex-wrap justify-center gap-1.5"
            >
              <GameText
                v-for="i in range(b.boss.recommendations)"
                :key="i"
                :text="text.get(`stygianBoss.${b.boss.id}.recommend.${i}`)"
                :sprites="data.data.sprites"
                :sprite-name="sprite"
                class="rounded-full border border-border-default bg-surface-sunken px-2.5 py-0.5 text-xs"
              />
            </span>
          </span>
        </component>
        <ol v-if="b.boss.mechanics" class="flex flex-col border-t border-border-default px-4">
          <li
            v-for="i in range(b.boss.mechanics)"
            :key="i"
            class="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2.5 py-3"
            :class="i > 0 ? 'border-t border-border-default' : ''"
          >
            <span
              class="flex size-6 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent-text"
              >{{ i + 1 }}</span
            >
            <div class="flex min-w-0 flex-col gap-1">
              <b class="text-sm">{{ text.get(`stygianBoss.${b.boss.id}.mechanic.${i}.name`) }}</b>
              <GameText
                :text="text.get(`stygianBoss.${b.boss.id}.mechanic.${i}.text`)"
                :sprites="data.data.sprites"
                :sprite-name="sprite"
                class="text-sm leading-relaxed text-text-secondary"
              />
            </div>
          </li>
        </ol>
        <a
          v-if="b.clears"
          :href="b.clears"
          target="_blank"
          rel="noopener noreferrer"
          class="flex items-center justify-center gap-1.5 border-t border-border-default px-4 py-2.5 text-sm text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
          :title="$t('endgame.stygian.clearsTip', { boss: b.full })"
        >
          {{ $t('endgame.stygian.clears') }}
          <ExternalLink class="size-3.5" aria-hidden="true" />
        </a>
      </article>
    </div>
  </div>
</template>
