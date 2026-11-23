<script setup lang="ts">
import { computed } from 'vue'
import { Lock, TriangleAlert } from 'lucide-vue-next'
import MaterialIcon from '@/components/materials-page/MaterialIcon.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import { artifactSetIcon, materialIcon } from '@/lib/assets'
import { t } from '@/i18n'
import { formatCompact, formatNumber } from '@/lib/format'
import { formatSetName } from '@/utils/artifact-stats'
import { materialName, materialRarity } from '@/utils/materials'
import type { MaterialLine } from '@gdt/game-data/planner-math'
import type { FarmCard } from './farm-today'
import { bracketText, daysText, statusTitle, weeksText } from './farm-format'
import GoalAvatars from './GoalAvatars.vue'
import MaterialCell from './MaterialCell.vue'

/**
 * One place to farm (Seelie's farm card): its name (a boss, an enemy, a
 * region, a domain) with the other places underneath, the runs, resin,
 * Condensed Resin and days it takes ("at most" where the estimate is an
 * upper bound), the materials still missing (each opens the inventory
 * editor) or the artifact sets wanted, and who needs them (a tap opens
 * the goal, a long press pauses it). Every card is laid out alike: the
 * items in a grid at the left, one row per rarity with the rarest on top
 * (at most three a row), and the name, figures and portraits beside it. A
 * card the account can't farm yet is greyed with what it lacks.
 */
const props = defineProps<{ card: FarmCard }>()

type Item = { line: MaterialLine; set?: never } | { set: string; line?: never }
/** Items a grid row holds before the next row starts. */
const PER_ROW = 3
const rows = computed(() => {
  const byRarity = new Map<number, Item[]>()
  const add = (rarity: number, item: Item) => {
    const row = byRarity.get(rarity)
    if (row) row.push(item)
    else byRarity.set(rarity, [item])
  }
  for (const line of props.card.lines) {
    add(materialRarity(line.material.key, line.material.rarity) ?? 0, { line })
  }
  for (const set of props.card.sets) add(5, { set })
  const out: { key: string; items: Item[] }[] = []
  for (const [rarity, items] of [...byRarity].sort((a, b) => b[0] - a[0])) {
    for (let i = 0; i < items.length; i += PER_ROW) {
      out.push({ key: `${rarity}:${i}`, items: items.slice(i, i + PER_ROW) })
    }
  }
  return out
})
const run = computed(() => props.card.run)
const locked = computed(() => props.card.lock !== null)

const runTitle = computed(() => {
  const r = run.value
  if (!r) return ''
  const runs = t('farm.card.runs', { n: formatNumber(r.runs) }, r.runs)
  const parts = [
    r.weekly
      ? t('farm.card.claimsWeekly', {
          claims: t('farm.card.claims', { n: formatNumber(r.runs) }, r.runs),
        })
      : r.upperBound
        ? t('farm.card.atMost', { runs })
        : runs,
    r.weekly && r.resinMax !== r.resin
      ? t('farm.card.resinRange', { min: formatNumber(r.resin), max: formatNumber(r.resinMax) })
      : t('farm.card.resin', { n: formatNumber(r.resin) }),
    t('farm.card.condensed', { n: formatNumber(r.condensed) }),
    r.weekly ? weeksText(r.days) : daysText(r.days),
  ]
  if (r.bracket) parts.push(bracketText(r.bracket))
  if (r.upperBound) parts.push(t('farm.card.guaranteed'))
  return parts.join(' · ')
})

const lockTitle = computed(() => {
  const lock = props.card.lock
  if (!lock) return ''
  return t('farm.card.lockTitle', {
    lock: lock.replace(/^AR /, 'Adventure Rank ').replace(/^WL /, 'World Level '),
  })
})
const KIND_TITLE: Partial<Record<FarmCard['kind'], string>> = {
  boss: 'boss',
  gem: 'gem',
  common: 'enemy',
  elite: 'enemy',
  local: 'local',
  artifact: 'artifact',
}
const title = computed(() => {
  const c = props.card
  if (c.id === 'artifact:elsewhere') return t('farm.card.elsewhereTitle')
  const kind = KIND_TITLE[c.kind]
  return [
    c.name,
    c.detail,
    c.domain === 'talent'
      ? t('planner.material.group.book')
      : c.domain === 'weapon'
        ? t('planner.material.group.weapon')
        : kind
          ? t(`farm.card.kind.${kind}`)
          : '',
  ]
    .filter(Boolean)
    .join(' · ')
})
const meta = computed(
  () =>
    !!props.card.detail ||
    locked.value ||
    !!run.value ||
    props.card.status === 'no-rate' ||
    props.card.paid > 0 ||
    props.card.blocked > 0,
)
</script>

<template>
  <article
    class="flex min-w-0 items-start gap-2 rounded-xl border border-border-default bg-surface-raised p-2 shadow-sm [contain-intrinsic-size:auto_6rem] [content-visibility:auto]"
    :class="locked ? 'opacity-60' : ''"
  >
    <div v-if="rows.length" class="flex shrink-0 flex-col gap-1">
      <div v-for="row in rows" :key="row.key" class="flex gap-1">
        <template v-for="item in row.items" :key="item.line?.material.key ?? item.set">
          <MaterialCell v-if="item.line" :line="item.line" size="xs" />
          <span v-else class="flex w-10 justify-center">
            <GameIcon
              :src="artifactSetIcon(item.set)"
              :name="formatSetName(item.set)"
              :title="formatSetName(item.set)"
              :rarity="5"
              size="sm"
            />
          </span>
        </template>
      </div>
    </div>

    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <h3 class="min-w-0 truncate text-sm leading-7 font-semibold" :title="title">
        {{ card.name }}
      </h3>

      <p
        v-if="meta"
        class="tabular flex flex-wrap items-center gap-x-2.5 gap-y-0.5 font-mono text-xs leading-5 text-text-secondary"
      >
        <span
          v-if="card.detail"
          class="max-w-full min-w-0 truncate font-sans text-text-muted"
          :title="title"
          >{{ card.detail }}</span
        >
        <span
          v-if="locked"
          class="inline-flex items-center gap-1 font-sans font-medium text-warning-text"
          :title="lockTitle"
        >
          <Lock class="size-3.5" aria-hidden="true" />
          {{ card.lock }}<span class="sr-only">: {{ lockTitle }}</span>
        </span>
        <template v-else-if="run">
          <span :title="runTitle"
            ><span v-if="run.upperBound" class="font-sans">{{
              `${$t('farm.card.atMostPrefix')} `
            }}</span
            >{{
              run.weekly
                ? $t('farm.card.claimsShort', { n: formatNumber(run.runs) })
                : $t('farm.card.runsShort', { n: formatNumber(run.runs) })
            }}<span class="sr-only"> ({{ runTitle }})</span></span
          >
          <span class="inline-flex items-center gap-0.5" :title="runTitle" aria-hidden="true">
            <span class="size-4 shrink-0">
              <MaterialIcon
                :src="materialIcon('OriginalResin')"
                :name="materialName('OriginalResin')"
              />
            </span>
            {{ formatCompact(run.resin) }}
          </span>
          <span
            v-if="run.condensed"
            class="inline-flex items-center gap-0.5"
            :title="$t('farm.card.condensedTitle', { n: formatNumber(run.condensed) })"
            aria-hidden="true"
          >
            <span class="size-4 shrink-0">
              <MaterialIcon
                :src="materialIcon('CondensedResin')"
                :name="materialName('CondensedResin')"
              />
            </span>
            {{ formatNumber(run.condensed) }}
          </span>
          <span :title="runTitle" aria-hidden="true">{{
            run.weekly ? weeksText(run.days) : daysText(run.days)
          }}</span>
        </template>
        <span
          v-else-if="card.status === 'no-rate'"
          class="font-sans text-text-muted"
          :title="statusTitle('no-rate')"
          >{{ $t('farm.card.noRate') }}</span
        >
        <span
          v-if="card.paid"
          class="text-text-muted"
          :title="$t('farm.card.paidTitle', { mora: formatNumber(card.paid) })"
          >{{ $t('farm.card.paid', { n: formatCompact(card.paid) }) }}</span
        >
        <span
          v-if="card.blocked"
          class="inline-flex items-center gap-1 font-sans text-warning-text"
          :title="$t('farm.card.blockedTitle', { n: formatNumber(card.blocked) })"
        >
          <TriangleAlert class="size-3.5" aria-hidden="true" />
          {{ $t('farm.card.blocked', { n: formatNumber(card.blocked) })
          }}<span class="sr-only">{{ $t('farm.card.blockedSr') }}</span>
        </span>
      </p>
      <slot />
      <GoalAvatars v-if="card.goals.length" class="mt-1" :goals="card.goals" :max="5" />
    </div>
  </article>
</template>
