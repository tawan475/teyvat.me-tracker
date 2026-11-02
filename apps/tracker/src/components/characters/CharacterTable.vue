<script setup lang="ts">
import { Heart, Wrench } from 'lucide-vue-next'
import CritValue from '@/components/ui/CritValue.vue'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import LevelText from '@/components/ui/LevelText.vue'
import {
  CHARACTER_SORTS,
  TARGET_LEVEL,
  type CharacterSort,
  type CharacterView,
  type SortDirection,
} from '@/data/characters'
import { artifactSetIcon, characterIcon, weaponIcon } from '@/lib/assets'
import { useExpNeed } from '@/lib/exp-need'
import { formatNumber, formatShort } from '@/lib/format'
import { formatLevel } from '@/lib/level'
import { t } from '@/i18n'
import FavoriteStar from './FavoriteStar.vue'
import SortHeader from './SortHeader.vue'
import TalentChips from './TalentChips.vue'
import { vStickyHead } from '@/lib/sticky-head'

/**
 * The roster as a dense list: one row per character, sortable headers. Rows
 * open the details like the cards do; the first column is the favourite
 * star. Every column shows at every width: the table scrolls sideways in its
 * own box with the star and the name pinned at its left (a phone saw only
 * Lv, C and CV, and could not reach the rest). Its pictures load up front:
 * lazy ones off to the side loaded and decoded mid-swipe, which stuttered.
 */
const props = defineProps<{
  characters: CharacterView[]
  /** Show the friendship column (the snapshot has irminsul's values). */
  friendship?: boolean
  favorites?: ReadonlySet<string>
}>()
defineEmits<{ open: [key: string]; favorite: [key: string] }>()
const sort = defineModel<CharacterSort>('sort', { required: true })
const direction = defineModel<SortDirection>('direction', { required: true })

function sortBy(key: CharacterSort) {
  if (sort.value === key) {
    direction.value = direction.value === 'desc' ? 'asc' : 'desc'
    return
  }
  sort.value = key
  direction.value = CHARACTER_SORTS.find((s) => s.value === key)?.natural ?? 'desc'
}

function ariaSort(key: CharacterSort) {
  if (sort.value !== key) return undefined
  return direction.value === 'asc' ? 'ascending' : 'descending'
}

const gapText = (c: CharacterView) => c.gaps.map((g) => g.text).join(' · ')

/**
 * The cards' two bars as thin lines under the Lv and Friendship cells (design
 * 2C): full at the cap, else the EXP toward the next level; none when the
 * capture sent no EXP.
 */
const expNeed = useExpNeed()
interface Bar {
  percent: number
  title: string
  /** "2.6K/12.5K"; null at the cap. */
  text: string | null
}
const expText = (exp: number, need: number) => `${formatShort(exp)}/${formatShort(need)}`
function levelBar(c: CharacterView): Bar | null {
  const need = expNeed.value?.character(c.level, c.ascension)
  if (need === undefined || (need !== null && c.exp === null)) return null
  if (need === null) return { percent: 100, title: t('characters.card.levelMax'), text: null }
  return {
    percent: Math.min(100, ((c.exp ?? 0) / need) * 100),
    text: expText(c.exp ?? 0, need),
    title: t('characters.card.levelExp', {
      exp: formatNumber(c.exp ?? 0),
      need: formatNumber(need),
    }),
  }
}
function friendshipBar(c: CharacterView): Bar | null {
  if (c.friendship === null) return null
  const need = expNeed.value?.friendship(c.friendship)
  if (need === undefined) return null
  if (need === null)
    return {
      percent: 100,
      title: t('characters.friendship.title', { level: c.friendship }),
      text: null,
    }
  if (c.friendshipExp === null) return null
  return {
    percent: Math.min(100, (c.friendshipExp / need) * 100),
    text: expText(c.friendshipExp, need),
    title: t('characters.card.friendshipExp', {
      level: c.friendship,
      exp: formatNumber(c.friendshipExp),
      need: formatNumber(need),
    }),
  }
}
const isFavorite = (c: CharacterView) => props.favorites?.has(c.key) ?? false
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-border-default bg-surface-raised shadow-sm">
    <div class="overflow-x-auto overscroll-x-contain">
      <table class="w-full table-fixed text-sm">
        <thead v-sticky-head class="border-b border-border-default text-text-secondary">
          <tr>
            <th scope="col" class="pin w-8 py-2 pl-1">
              <span class="sr-only">{{ $t('characters.favorite.on') }}</span>
            </th>
            <th
              scope="col"
              class="pin pin-name w-36 py-2 pr-2 pl-1 text-left sm:w-48"
              :aria-sort="ariaSort('name')"
            >
              <SortHeader
                :label="$t('characters.sort.name')"
                :active="sort === 'name'"
                :direction="direction"
                @sort="sortBy('name')"
              />
            </th>
            <th scope="col" class="w-20 px-2 py-2 text-right" :aria-sort="ariaSort('level')">
              <SortHeader
                :label="$t('characters.table.lv')"
                :title="$t('characters.sort.level')"
                :active="sort === 'level'"
                :direction="direction"
                @sort="sortBy('level')"
              />
            </th>
            <th scope="col" class="w-24 px-2 py-2 text-right font-medium">
              {{ $t('characters.table.exp') }}
            </th>
            <th
              scope="col"
              class="w-12 px-2 py-2 text-right"
              :aria-sort="ariaSort('constellation')"
            >
              <SortHeader
                :label="$t('characters.table.c')"
                :title="$t('game.constellation')"
                :active="sort === 'constellation'"
                :direction="direction"
                @sort="sortBy('constellation')"
              />
            </th>
            <th
              v-if="friendship"
              scope="col"
              class="w-32 px-2 py-2 text-left"
              :aria-sort="ariaSort('friendship')"
            >
              <SortHeader
                :label="$t('game.friendship')"
                :active="sort === 'friendship'"
                :direction="direction"
                @sort="sortBy('friendship')"
              />
            </th>
            <th scope="col" class="w-32 px-2 py-2 text-left" :aria-sort="ariaSort('talents')">
              <SortHeader
                :label="$t('game.talents')"
                :active="sort === 'talents'"
                :direction="direction"
                @sort="sortBy('talents')"
              />
            </th>
            <th scope="col" class="w-32 px-2 py-2 text-left font-medium">
              {{ $t('game.weapon') }}
            </th>
            <th scope="col" class="w-32 px-2 py-2 text-left font-medium">
              {{ $t('characters.sets') }}
            </th>
            <th
              scope="col"
              class="w-24 px-2 py-2 text-right font-medium"
              :title="$t('characters.table.critTitle')"
            >
              {{ $t('characters.table.crit') }}
            </th>
            <th scope="col" class="w-20 px-2 py-2 text-right" :aria-sort="ariaSort('cv')">
              <SortHeader
                label="CV"
                :title="$t('artifacts.sortTitle.cv')"
                :active="sort === 'cv'"
                :direction="direction"
                @sort="sortBy('cv')"
              />
            </th>
            <th scope="col" class="w-10 px-2 py-2">
              <span class="sr-only">{{ $t('characters.table.toDo') }}</span>
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border-subtle">
          <tr
            v-for="c in characters"
            :key="c.key"
            class="group/fav cursor-pointer transition-colors"
            @click="$emit('open', c.key)"
          >
            <td class="pin py-1.5 pl-1">
              <FavoriteStar :on="isFavorite(c)" :name="c.name" @toggle="$emit('favorite', c.key)" />
            </td>
            <td class="pin pin-name py-1.5 pr-2 pl-1">
              <button
                type="button"
                aria-haspopup="dialog"
                class="flex w-full min-w-0 items-center gap-2 text-left sm:gap-2.5"
                :title="c.name"
                @click.stop="$emit('open', c.key)"
              >
                <GameIcon
                  :src="characterIcon(c.key)"
                  :name="c.name"
                  :rarity="c.rarity ?? undefined"
                  size="sm"
                  eager
                />
                <ElementIcon v-if="c.element" :element="c.element" class="hidden sm:block" />
                <span class="min-w-0 truncate font-medium">{{ c.name }}</span>
              </button>
            </td>
            <td class="px-2 py-1.5 text-right" :title="levelBar(c)?.title">
              <LevelText :level="c.level" :ascension="c.ascension" :target="TARGET_LEVEL" bare />
              <span
                v-if="levelBar(c)"
                class="mt-1 block h-[3px] overflow-hidden rounded-full bg-surface-sunken"
                aria-hidden="true"
                ><span
                  class="block h-full rounded-full bg-accent"
                  :style="{ width: `${levelBar(c)!.percent}%` }"
              /></span>
            </td>
            <td
              class="tabular px-2 py-1.5 text-right font-mono text-text-secondary"
              :title="levelBar(c)?.title"
            >
              <span v-if="!levelBar(c)" class="text-text-muted">—</span>
              <span v-else-if="levelBar(c)!.text === null" class="font-sans text-text-muted">{{
                $t('characters.card.max')
              }}</span>
              <template v-else>{{ levelBar(c)!.text }}</template>
            </td>
            <td class="tabular px-2 py-1.5 text-right font-mono">{{ c.constellation }}</td>
            <td v-if="friendship" class="px-2 py-1.5" :title="friendshipBar(c)?.title">
              <span v-if="c.friendship !== null" class="flex items-center justify-between gap-2">
                <span class="tabular flex flex-none items-center gap-1">
                  <Heart class="size-3.5 fill-current text-friendship" aria-hidden="true" />
                  {{ c.friendship }}
                </span>
                <span
                  v-if="friendshipBar(c)?.text"
                  class="tabular truncate font-mono text-xs text-text-muted"
                  >{{ friendshipBar(c)!.text }}</span
                >
                <span v-else-if="friendshipBar(c)" class="text-xs text-text-muted">{{
                  $t('characters.card.max')
                }}</span>
              </span>
              <span v-else class="text-text-muted">—</span>
              <span
                v-if="friendshipBar(c)"
                class="mt-1 block h-[3px] w-full overflow-hidden rounded-full bg-surface-sunken"
                aria-hidden="true"
                ><span
                  class="block h-full rounded-full bg-friendship"
                  :style="{ width: `${friendshipBar(c)!.percent}%` }"
              /></span>
            </td>
            <td class="px-2 py-1.5">
              <TalentChips :talent="c.talent" />
            </td>
            <td class="px-2 py-1.5">
              <span
                v-if="c.weapon"
                class="flex items-center gap-1.5"
                :title="`${c.weapon.name} · ${formatLevel(c.weapon.level, c.weapon.ascension)} · R${c.weapon.refinement}`"
              >
                <GameIcon
                  :src="weaponIcon(c.weapon.key, c.weapon.ascension)"
                  :name="c.weapon.name"
                  :rarity="c.weapon.rarity ?? undefined"
                  size="xs"
                  eager
                />
                <span class="tabular font-mono">R{{ c.weapon.refinement }}</span>
                <LevelText
                  :level="c.weapon.level"
                  :ascension="c.weapon.ascension"
                  :target="TARGET_LEVEL"
                  bare
                />
              </span>
              <span v-else class="text-text-muted">—</span>
            </td>
            <td class="px-2 py-1.5">
              <span class="flex items-center gap-2">
                <span
                  v-for="set in c.activeSets.slice(0, 2)"
                  :key="set.setKey"
                  class="flex shrink-0 items-center gap-1"
                  :title="`${set.name} ×${set.count}`"
                >
                  <GameIcon
                    :src="artifactSetIcon(set.setKey)"
                    :name="set.name"
                    :rarity="set.rarity"
                    size="xs"
                    eager
                  />
                  <span class="tabular font-mono">{{ set.count }}</span>
                </span>
                <span v-if="!c.activeSets.length" class="text-text-muted">—</span>
              </span>
            </td>
            <td class="tabular px-2 py-1.5 text-right font-mono text-text-secondary">
              <template v-if="c.artifactCount">{{ c.critRate }} / {{ c.critDmg }}</template>
              <template v-else>—</template>
            </td>
            <td class="px-2 py-1.5 text-right">
              <CritValue v-if="c.artifactCount" :value="c.cv" scope="build" />
              <span v-else class="text-text-muted">—</span>
            </td>
            <td class="px-2 py-1.5 text-right">
              <span v-if="c.gaps.length" class="inline-flex text-warning-text" :title="gapText(c)">
                <Wrench class="size-4" aria-hidden="true" />
                <span class="sr-only">{{
                  $t('characters.table.toDoList', { gaps: gapText(c) })
                }}</span>
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* Solid row and header grounds: the pinned cells hide what scrolls under them. */
thead tr,
thead .pin {
  background: color-mix(in srgb, var(--color-surface-overlay) 50%, var(--color-surface-raised));
}
.pin {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--color-surface-raised);
}
tbody tr:hover,
tbody tr:hover .pin {
  background: color-mix(in srgb, var(--color-surface-overlay) 60%, var(--color-surface-raised));
}
/* After the star column (w-8). */
.pin-name {
  left: 2rem;
  box-shadow: inset -1px 0 var(--color-border-subtle);
}
</style>
