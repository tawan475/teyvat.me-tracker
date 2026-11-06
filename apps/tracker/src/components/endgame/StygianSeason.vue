<script setup lang="ts">
import { computed, defineAsyncComponent, ref, shallowRef, watch } from 'vue'
import { ExternalLink, Minus, Share2, User, Users } from 'lucide-vue-next'
import type { GiStygianRecord } from '@gdt/shared'
import type { EndgameText, StygianSeason } from '@gdt/game-data/endgame'
import GameText from '@/components/game/GameText.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import BossPicture from './BossPicture.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import UiButton from '@/components/ui/UiButton.vue'
import {
  loadEndgameData,
  soloFirst,
  stygianBossPicture,
  stygianDifficultyName,
  stygianHpTip as hpTip,
  type EndgameData,
} from '@/data/endgame'
import {
  fightsDone,
  formatFightTime,
  recordTotal,
  type CapturedStygian,
} from '@/data/endgame-capture'
import { loadProfileArt, type ProfileArt } from '@/data/profile-card'
import { coopBadge, fightMembers, recordPlayers } from '@/data/stygian-coop'
import { characterName } from '@/i18n/game-names'
import { t } from '@/i18n'
import { formatDate, formatNumber, formatShort } from '@/lib/format'
import { characterIcon, gameIcon } from '@/lib/assets'
import { STYGIAN_GROUND } from './modes'

/**
 * A Stygian Onslaught season: its difficulties as a scale (each with its
 * monster level; the hardest first chosen), then the three opponents. A
 * card's top (picture, name, HP at the chosen level, the characters the game
 * recommends, centred) is one button that opens the boss's Living Beings entry;
 * below it, its mechanics, numbered, and a link to the boss's community
 * clears on stygian.moe (a fan site, the users' ask; the header links the
 * site itself). With a capture of the account's records this season
 * (`records`, Capture 1.17.12) a card per record (solo, co-op) lists each
 * fight's boss, time, done mark and the player's team between the scale and
 * the opponents, and the scale starts at the hardest difficulty they played.
 */
const props = defineProps<{
  season: StygianSeason
  data: EndgameData
  name: string
  period: string
  left: number
  records?: CapturedStygian | null
}>()
defineEmits<{
  /** An enemy to open, at its level, with its HP in this fight (0 unknown; `before`: before the bonus). */
  enemy: [codex: number, level: number, hp: number, before?: boolean]
}>()

const text = computed(() => props.data.text)
const sprite = (id: number) => text.value.get(`sprite.${id}`)
const difficulty = ref(0)
/** The hardest difficulty the account has a record on, else the season's hardest. */
const startAt = () => {
  const own = new Set(props.records?.records.map((r) => r.difficulty) ?? [])
  const played = props.season.difficulties.filter((d) => own.has(d.difficulty)).at(-1)
  return played?.difficulty ?? props.season.difficulties.at(-1)?.difficulty ?? 0
}
watch([() => props.season.id, () => props.records], () => (difficulty.value = startAt()), {
  immediate: true,
})
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
/**
 * The co-op players' profile pictures (Capture 1.17.20) come from the game
 * data's player topic, loaded only when a record names one.
 */
const profileArt = shallowRef<ProfileArt | null>(null)
watch(
  () => props.records?.records.some((r) => r.players?.some((p) => p.picture)),
  (named) => {
    if (named && !profileArt.value)
      loadProfileArt().then(
        (a) => (profileArt.value = a),
        () => {},
      )
  },
  { immediate: true },
)

/**
 * The account's records this season, solo first: each fight with the boss
 * of that slot on the record's difficulty (its icon and short name), the
 * time, whether it was done and the player's team.
 */
const yourRecords = computed(() => {
  if (!props.records) return []
  const from = t('endgame.captured.fromCapture', { date: formatDate(props.records.takenAt) })
  return soloFirst(props.records.records).map((r) => {
    const row = props.season.difficulties.find((d) => d.difficulty === r.difficulty)
    const total = recordTotal(r)
    // A co-op record's players (Capture 1.17.20): the game's badge, picture, name.
    const players = recordPlayers(r).map((p) => {
      const icon = p.picture ? profileArt.value?.avatars.get(p.picture) : undefined
      const name = p.nickname || `${p.p}P`
      return {
        p: p.p,
        tag: `${p.p}P`,
        badge: coopBadge(p.p, p.self),
        picture: icon ? gameIcon(icon) : '',
        name,
        self: p.self,
        title: `${p.p}P · ${name}${p.self ? ` (${t('endgame.captured.you')})` : ''}`,
      }
    })
    const playerTitle = (n: number) => players.find((p) => p.p === n)?.title ?? `${n}P`
    return {
      players,
      key: `${r.coop ? 'c' : 's'}-${r.difficulty}-${r.at}`,
      record: r,
      coop: r.coop,
      label: stygianDifficultyName(r.difficulty, text.value),
      level: row?.level ?? 0,
      date: formatDate(r.at * 1000),
      from,
      done: fightsDone(r),
      total: total === null ? '' : formatFightTime(total),
      fights: r.fights.map((f, i) => {
        const id = row?.bosses[i]
        const full = id === undefined ? '' : text.value.get(`stygianBoss.${id}.name`)
        return {
          icon: (id === undefined ? undefined : props.data.data.stygianBosses.get(id))?.icon ?? '',
          name: full ? full.split(':')[0]!.trim() : t('endgame.captured.fight', { n: i + 1 }),
          full,
          time: formatFightTime(f.time),
          done: f.done,
          // Every player's characters with their badge (co-op, 1.17.20+);
          // the account's own team alone before that.
          team: fightMembers(r, f).map((m, n) => ({
            id: `${n}-${m.key}`,
            key: m.key,
            badge: m.p === null ? '' : coopBadge(m.p, m.self),
            tag: m.p === null ? '' : `${m.p}P`,
            title:
              m.p === null ? characterName(m.key) : `${characterName(m.key)} · ${playerTitle(m.p)}`,
          })),
          // The strongest strike and the top damage (v1 addition), with the character when named.
          figures: (['strike', 'damage'] as const).flatMap((kind) => {
            const figure = f[kind]
            if (!figure) return []
            const by = figure.by ? characterName(figure.by) : ''
            return [
              {
                kind,
                label: t(`endgame.captured.${kind}`),
                short: formatShort(figure.value),
                title: `${t(`endgame.captured.${kind}`)}: ${formatNumber(figure.value)}${by ? ` · ${by}` : ''}`,
                by: figure.by ?? '',
                byName: by,
              },
            ]
          }),
        }
      }),
    }
  })
})

/**
 * Solo and co-op side by side whenever there is any record: a kind without
 * one this season gets an empty "No record" card in its place (the grid
 * stretches it to the other's height; the user's ask, 2026-11-06).
 */
const recordSlots = computed(() => {
  if (!yourRecords.value.length) return []
  const kinds = [false, true].map((coop) => {
    const own = yourRecords.value.filter((r) => r.coop === coop)
    return own.length ? own : [{ key: coop ? 'c-none' : 's-none', coop, empty: true as const }]
  })
  return kinds.flat()
})

/** The record whose share card is open (the dialog loads on first use). */
const StygianShareModal = defineAsyncComponent(() => import('./StygianShareModal.vue'))
const sharing = shallowRef<GiStygianRecord | null>(null)
const shareOpened = ref(false)
function share(record: GiStygianRecord) {
  shareOpened.value = true
  sharing.value = record
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

    <section v-if="recordSlots.length" class="flex flex-col gap-2">
      <h3 class="text-xs font-semibold tracking-wide text-text-muted uppercase">
        {{ $t('endgame.captured.records') }}
      </h3>
      <div class="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
        <template v-for="r in recordSlots" :key="r.key">
          <article
            v-if="'empty' in r"
            class="flex min-w-0 flex-col rounded-xl border border-dashed border-border-default bg-surface-raised/60"
          >
            <header class="flex items-center gap-2 border-b border-border-default px-4 py-2.5">
              <UiBadge>
                <component :is="r.coop ? Users : User" class="size-3.5" aria-hidden="true" />
                {{ r.coop ? $t('endgame.captured.coop') : $t('endgame.captured.solo') }}
              </UiBadge>
            </header>
            <p class="flex flex-1 items-center justify-center px-4 py-8 text-sm text-text-muted">
              {{ $t('endgame.captured.noRecord') }}
            </p>
          </article>
          <article
            v-else
            class="flex min-w-0 flex-col rounded-xl border border-border-default bg-surface-raised shadow-sm"
            :title="r.from"
          >
            <header
              class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border-default px-4 py-2.5"
            >
              <span class="flex min-w-0 flex-wrap items-center gap-2">
                <UiBadge>
                  <component :is="r.coop ? Users : User" class="size-3.5" aria-hidden="true" />
                  {{ r.coop ? $t('endgame.captured.coop') : $t('endgame.captured.solo') }}
                </UiBadge>
                <span class="truncate text-sm font-semibold">{{ r.label }}</span>
                <span v-if="r.level" class="tabular font-mono text-xs text-text-muted">{{
                  $t('endgame.level', { n: r.level })
                }}</span>
              </span>
              <span class="flex items-center gap-2">
                <span class="tabular font-mono text-xs text-text-muted">{{ r.date }}</span>
                <UiButton size="sm" :title="$t('endgame.share.title')" @click="share(r.record)">
                  <Share2 class="size-4" aria-hidden="true" />{{ $t('share.export.share') }}
                </UiButton>
              </span>
              <!-- The co-op players, as the game's record screen lists them. -->
              <ul
                v-if="r.players.length"
                class="flex basis-full flex-wrap items-center gap-x-4 gap-y-1.5 pt-1"
              >
                <li
                  v-for="pl in r.players"
                  :key="pl.p"
                  class="flex min-w-0 items-center gap-1.5"
                  :title="pl.title"
                >
                  <img :src="pl.badge" :alt="pl.tag" class="size-6 shrink-0" data-skeleton="off" />
                  <img
                    v-if="pl.picture"
                    :src="pl.picture"
                    alt=""
                    loading="lazy"
                    class="size-6 shrink-0 rounded-full border border-border-strong bg-surface-overlay object-cover"
                  />
                  <span class="truncate text-xs font-semibold">{{ pl.name }}</span>
                  <span v-if="pl.self" class="text-xs text-text-muted"
                    >({{ $t('endgame.captured.you') }})</span
                  >
                </li>
              </ul>
            </header>
            <ol class="flex flex-col px-4">
              <li
                v-for="(f, i) in r.fights"
                :key="i"
                class="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5"
                :class="i > 0 && 'border-t border-border-default'"
              >
                <!-- The boss as tall as the row's name, team and figures (the user's ask: fill the space). -->
                <GameIcon :src="gameIcon(f.icon)" :name="f.full || f.name" size="xl" />
                <span class="flex min-w-0 flex-col gap-1">
                  <span class="truncate text-sm font-semibold" :title="f.full || undefined">{{
                    f.name
                  }}</span>
                  <span v-if="f.team.length" class="flex flex-wrap gap-2 ps-1">
                    <span
                      v-for="m in f.team"
                      :key="m.id"
                      class="relative size-12 shrink-0"
                      :title="m.title"
                    >
                      <img
                        :src="characterIcon(m.key)"
                        :alt="characterName(m.key)"
                        loading="lazy"
                        class="size-12 rounded-full border border-border-strong bg-surface-overlay object-cover"
                      />
                      <img
                        v-if="m.badge"
                        :src="m.badge"
                        :alt="m.tag"
                        data-skeleton="off"
                        class="absolute -bottom-1 -left-1.5 size-6"
                      />
                    </span>
                  </span>
                  <span v-if="f.figures.length" class="flex flex-wrap gap-x-3 gap-y-1 pt-1">
                    <span
                      v-for="g in f.figures"
                      :key="g.kind"
                      class="flex items-center gap-1 text-xs text-text-secondary"
                      :title="g.title"
                    >
                      {{ g.label }}
                      <b class="tabular font-mono text-text-primary">{{ g.short }}</b>
                      <img
                        v-if="g.by"
                        :src="characterIcon(g.by)"
                        :alt="g.byName"
                        loading="lazy"
                        class="size-6 rounded-full border border-border-strong bg-surface-overlay object-cover"
                      />
                    </span>
                  </span>
                </span>
                <!-- Not done is a struck time and a mark, never the colour alone (no tick on a clear: the user's call). -->
                <span
                  class="flex items-center gap-1.5 justify-self-end"
                  :title="
                    f.done ? $t('endgame.captured.cleared') : $t('endgame.captured.notCleared')
                  "
                >
                  <span
                    class="tabular font-mono text-sm font-semibold"
                    :class="f.done ? '' : 'text-text-muted line-through'"
                    >{{ f.time }}</span
                  >
                  <Minus v-if="!f.done" class="size-4 text-text-muted" aria-hidden="true" />
                  <span class="sr-only">{{
                    f.done ? $t('endgame.captured.cleared') : $t('endgame.captured.notCleared')
                  }}</span>
                </span>
              </li>
            </ol>
            <footer
              class="flex items-center justify-between gap-3 border-t border-border-default px-4 py-2 text-sm"
            >
              <span class="text-text-secondary">{{
                r.total
                  ? $t('endgame.captured.total')
                  : $t('endgame.captured.clearedOf', { n: r.done, total: r.fights.length })
              }}</span>
              <span v-if="r.total" class="tabular font-mono font-semibold">{{ r.total }}</span>
            </footer>
          </article>
        </template>
      </div>
    </section>

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
    <StygianShareModal
      v-if="shareOpened"
      :open="!!sharing"
      :record="sharing"
      :season="season"
      :data="data"
      :season-name="name"
      @close="sharing = null"
    />
  </div>
</template>
