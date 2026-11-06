<script setup lang="ts">
import { computed, useId } from 'vue'
import { t } from '@/i18n'
import { Backpack, FlaskConical, Lock, LockOpen, Sparkle } from 'lucide-vue-next'
import CritValue from '@/components/ui/CritValue.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import RarityStars from '@/components/ui/RarityStars.vue'
import RollValue from '@/components/ui/RollValue.vue'
import RollBars from '@/components/ui/RollBars.vue'
import ExpProgress from '@/components/ui/ExpProgress.vue'
import UiBadge from '@/components/ui/UiBadge.vue'
import { useExpNeed } from '@/lib/exp-need'
import type { ArtifactRow } from '@/data/artifacts'
import { artifactIcon, characterIcon } from '@/lib/assets'
import { isCritCirclet } from '@/lib/crit-tiers'
import { formatNumber } from '@/lib/format'
import { characterName } from '@/i18n/game-names'
import { ROLL_QUALITY_LABEL, ROLL_QUALITY_TEXT, maxLevel } from '@/utils/artifact-rolls'
import {
  formatRollValue,
  formatSlotFullName,
  formatSlotName,
  formatStatName,
  formatStatShort,
  formatStatValue,
} from '@/utils/artifact-stats'

/**
 * One artifact: stats, rank, who wears it, every roll coloured by tier and,
 * while it can still level, its potential (what the upgrades to come should
 * add; data/artifact-potential).
 */
const props = defineProps<{
  row: ArtifactRow
  /** CV position among pieces of the same slot and rarity. */
  rank?: { position: number; of: number }
  isNew?: boolean
  /** Shown beside its card (the dialog's preview): no header or wearer line of its own. */
  withCard?: boolean
}>()

const artifact = computed(() => props.row.artifact)
// A bar only for a piece the capture says is partway into a level.
const expNeed = useExpNeed()
const expToNext = computed(() =>
  artifact.value.gi_exp
    ? (expNeed.value?.artifact(artifact.value.rarity, artifact.value.level) ?? null)
    : null,
)
const owner = computed(() =>
  artifact.value.location ? characterName(artifact.value.location) : '',
)
const inactive = computed(() => artifact.value.unactivatedSubstats ?? [])
const potential = computed(() => props.row.potential)
const left = computed(() => potential.value.left)
const plain = computed(() => artifact.value.rarity < 5)
const critCirclet = computed(() =>
  isCritCirclet(artifact.value.slotKey, artifact.value.mainStatKey),
)
const maxed = computed(() => `+${maxLevel(artifact.value.rarity)}`)
const potentialId = useId()
const rollsTitle = computed(() => {
  const source =
    (artifact.value.totalRolls ?? 0) > 0
      ? t('artifacts.detail.fromGame')
      : t('artifacts.detail.inferred')
  return left.value > 0 ? t('artifacts.detail.upgradesToCome', { source, n: left.value }) : source
})
const rankTitle = computed(() =>
  props.rank
    ? t('artifacts.detail.rankTitle', {
        n: formatNumber(props.rank.of),
        rarity: artifact.value.rarity,
        slot: formatSlotName(artifact.value.slotKey).toLowerCase(),
      })
    : '',
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="!withCard" class="flex items-start gap-4">
      <GameIcon
        :src="artifactIcon(artifact.setKey, artifact.slotKey)"
        :name="row.setName"
        :rarity="artifact.rarity"
        size="lg"
        aria-hidden="true"
      />
      <div class="min-w-0 flex-1">
        <p class="text-sm text-text-secondary">{{ formatSlotFullName(artifact.slotKey) }}</p>
        <p class="font-display text-lg font-bold">{{ formatStatName(artifact.mainStatKey) }}</p>
        <p class="mt-0.5 flex items-center gap-2">
          <RarityStars :rarity="artifact.rarity" />
          <span class="tabular font-mono text-sm">
            +{{ artifact.level
            }}<span class="text-text-muted">/{{ maxLevel(artifact.rarity) }}</span>
          </span>
          <ExpProgress v-if="expToNext" :exp="artifact.gi_exp ?? 0" :need="expToNext" />
          <UiBadge v-if="isNew" tone="accent" :title="$t('artifacts.detail.newTitle')">{{
            $t('artifacts.label.new')
          }}</UiBadge>
        </p>
      </div>
    </div>

    <dl class="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div class="rounded-xl border border-border-default px-3 py-2">
        <dt class="text-sm text-text-secondary">CV</dt>
        <dd class="text-xl font-semibold">
          <CritValue :value="row.cv" :crit-circlet="critCirclet" :plain="plain" />
        </dd>
      </div>
      <div class="rounded-xl border border-border-default px-3 py-2">
        <dt class="text-sm text-text-secondary">RV</dt>
        <dd class="text-xl"><RollValue :value="row.rv" :plain="plain" /></dd>
      </div>
      <div class="rounded-xl border border-border-default px-3 py-2" :title="rollsTitle">
        <dt class="text-sm text-text-secondary">{{ $t('artifacts.detail.rolls') }}</dt>
        <dd class="tabular font-mono text-xl">
          {{ row.rollCount }}
          <span v-if="left > 0" class="text-base text-text-muted">+{{ left }}</span>
        </dd>
      </div>
      <div v-if="rank" class="rounded-xl border border-border-default px-3 py-2" :title="rankTitle">
        <dt class="text-sm text-text-secondary">{{ $t('artifacts.detail.rank') }}</dt>
        <dd class="tabular font-mono text-xl">
          #{{ formatNumber(rank.position)
          }}<span class="text-base text-text-muted"> / {{ formatNumber(rank.of) }}</span>
        </dd>
      </div>
    </dl>

    <section v-if="left > 0" :aria-labelledby="potentialId" class="flex flex-col gap-2">
      <h3 :id="potentialId" class="text-sm font-medium text-text-secondary">
        {{ $t('artifacts.sort.potential') }}
        <span class="tabular font-mono text-text-muted">{{ maxed }}</span>
      </h3>
      <dl class="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div
          class="rounded-xl bg-surface-overlay/60 px-3 py-2"
          :title="$t('artifacts.detail.upgradesTitle', { max: maxed })"
        >
          <dt class="text-sm text-text-secondary">{{ $t('artifacts.detail.upgrades') }}</dt>
          <dd class="tabular font-mono text-lg">{{ left }}</dd>
        </div>
        <div class="rounded-xl bg-surface-overlay/60 px-3 py-2">
          <dt class="text-sm text-text-secondary">{{ $t('artifacts.detail.expectedCv') }}</dt>
          <dd class="text-lg">
            <CritValue
              :value="potential.expectedCv"
              :crit-circlet="critCirclet"
              :plain="plain"
              :detail="
                $t('artifacts.detail.expectedDetail', {
                  max: maxed,
                  chance: Math.round(potential.critChance * 100),
                })
              "
            />
          </dd>
        </div>
        <div class="rounded-xl bg-surface-overlay/60 px-3 py-2">
          <dt class="text-sm text-text-secondary">{{ $t('artifacts.detail.bestCase') }}</dt>
          <dd class="text-lg">
            <CritValue
              :value="potential.bestCv"
              :crit-circlet="critCirclet"
              :plain="plain"
              :detail="$t('artifacts.detail.bestDetail', { max: maxed })"
            />
          </dd>
        </div>
        <div
          class="rounded-xl bg-surface-overlay/60 px-3 py-2"
          :title="$t('artifacts.detail.critLinesTitle', { n: potential.critLines })"
        >
          <dt class="text-sm text-text-secondary">{{ $t('artifacts.detail.critPerRoll') }}</dt>
          <dd class="tabular font-mono text-lg">{{ Math.round(potential.critChance * 100) }}%</dd>
        </div>
        <div
          v-if="potential.activates"
          class="rounded-xl bg-surface-overlay/60 px-3 py-2"
          :title="$t('artifacts.detail.activatesTitle')"
        >
          <dt class="text-sm text-text-secondary">{{ $t('artifacts.detail.activates') }}</dt>
          <dd class="flex items-baseline gap-1.5 text-lg">
            <span class="truncate">{{ formatStatShort(potential.activates.key) }}</span>
            <span class="tabular font-mono">{{
              formatStatValue(potential.activates.key, potential.activates.value)
            }}</span>
          </dd>
        </div>
        <div class="rounded-xl bg-surface-overlay/60 px-3 py-2">
          <dt class="text-sm text-text-secondary">{{ $t('artifacts.detail.maxRv') }}</dt>
          <dd class="text-lg"><RollValue :value="potential.maxRv" :plain="plain" /></dd>
        </div>
      </dl>
    </section>

    <ul
      v-if="!withCard"
      class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-text-secondary"
    >
      <li class="flex items-center gap-2">
        <template v-if="owner">
          <GameIcon
            :src="characterIcon(artifact.location)"
            :name="owner"
            size="sm"
            aria-hidden="true"
          />
          <span class="font-medium text-text-primary">{{ owner }}</span>
        </template>
        <template v-else>
          <Backpack class="size-4" aria-hidden="true" />
          {{ $t('weapons.detail.unequipped') }}
        </template>
      </li>
      <li class="flex items-center gap-1.5">
        <Lock v-if="artifact.lock" class="size-4" aria-hidden="true" />
        <LockOpen v-else class="size-4" aria-hidden="true" />
        {{ artifact.lock ? $t('artifacts.label.locked') : $t('artifacts.detail.unlocked') }}
      </li>
      <li v-if="artifact.astralMark" class="flex items-center gap-1.5">
        <Sparkle class="size-4 fill-current text-rarity-5" aria-hidden="true" />
        {{ $t('artifacts.detail.astral') }}
      </li>
      <li
        v-if="artifact.elixirCrafted"
        class="flex items-center gap-1.5"
        :title="$t('artifacts.detail.elixirTitle')"
      >
        <FlaskConical class="size-4" aria-hidden="true" />
        {{ $t('artifacts.table.elixir') }}
      </li>
    </ul>

    <ul
      class="divide-y divide-border-subtle rounded-xl border border-border-default"
      :aria-label="$t('game.substats')"
    >
      <li
        v-for="(substat, index) in artifact.substats"
        :key="substat.key"
        class="flex flex-col gap-1 px-3 py-2.5"
      >
        <div class="flex items-center gap-3">
          <span class="min-w-0 flex-1">{{ formatStatName(substat.key) }}</span>
          <RollBars :rolls="row.rolls[index] ?? []" size="lg" />
          <span class="tabular w-16 text-right font-mono font-medium">
            {{ formatStatValue(substat.key, substat.value) }}
          </span>
        </div>
        <div
          v-if="row.rolls[index]?.length"
          class="tabular flex flex-wrap gap-x-3 font-mono text-sm"
          :aria-label="$t('characters.piece.rolls', { n: row.rolls[index]!.length })"
        >
          <span
            v-for="(roll, n) in row.rolls[index]"
            :key="n"
            :class="ROLL_QUALITY_TEXT[roll.quality]"
            :title="$t('artifacts.detail.rollTier', { tier: ROLL_QUALITY_LABEL[roll.quality] })"
          >
            {{ formatRollValue(substat.key, roll.value) }}
          </span>
        </div>
      </li>
      <li
        v-for="substat in inactive"
        :key="`inactive-${substat.key}`"
        class="flex items-center gap-3 px-3 py-2.5 text-text-muted"
        :title="$t('characters.piece.activatesAt4')"
      >
        <span class="min-w-0 flex-1">{{ formatStatName(substat.key) }}</span>
        <span class="text-sm">{{ $t('artifacts.detail.inactive') }}</span>
        <span class="tabular w-16 text-right font-mono">
          {{ formatStatValue(substat.key, substat.value) }}
        </span>
      </li>
    </ul>
  </div>
</template>
