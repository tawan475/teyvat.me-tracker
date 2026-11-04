<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { ArrowRight, ArrowUp, Backpack, Lock } from 'lucide-vue-next'
import type { WeaponDetail as WeaponText } from '@gdt/game-data/details'
import { displayStat, hasWeaponStats, weaponBaseStats } from '@gdt/game-data/stats'
import GameText from '@/components/game/GameText.vue'
import GameIcon from '@/components/ui/GameIcon.vue'
import ExpProgress from '@/components/ui/ExpProgress.vue'
import LevelText from '@/components/ui/LevelText.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import { useExpNeed } from '@/lib/exp-need'
import RarityStars from '@/components/ui/RarityStars.vue'
import { formatPanelValue, statLabel } from '@/data/character-build'
import {
  MAX_REFINEMENT,
  WEAPON_TYPE_LABELS,
  weaponTitle,
  type WeaponGroup,
  type WeaponRow,
} from '@/data/weapons'
import { characterIcon, weaponIcon } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { useAccountRoute } from '@/views/account/context'

/**
 * Every copy of one weapon. The head is the chosen copy as the game shows a
 * selected weapon ("R5 · Lv. 90/90", refinement diamonds, who wears it);
 * then the weapon itself as its in-game page reads (the user's ask,
 * 2026-11-04): its stats at that copy's level, the passive at a refinement
 * one can step through, and its lore; below, one line per copy or stack of
 * spare copies, the chosen one highlighted. Picking a line chooses it.
 * `bare` (a weapon the account doesn't own, data/weapons.ts
 * bareWeaponGroup): the weapon's page alone, at its level cap.
 */
const props = defineProps<{
  group: WeaponGroup
  selectedId: string | null
  accountId: number
  bare?: boolean
}>()
const emit = defineEmits<{ select: [id: string] }>()
const routeName = useAccountRoute()

const g = computed(() => props.group)
const selected = computed<WeaponRow>(
  () => g.value.rows.find((r) => r.id === props.selectedId) ?? g.value.best,
)

// --------------------------------------------------------------- the weapon's page
// Stats at the chosen copy's level, as the weapon's page lists them: Base ATK and the substat
// (none on 1-2★); the passive's own stats are in its text.
const stats = computed(() => {
  const w = selected.value
  if (!hasWeaponStats(w.key)) return []
  const values = weaponBaseStats({ key: w.key, level: w.level, ascension: w.ascension })
  return Object.entries(values)
    .sort(([a], [b]) => (a === 'baseAtk' ? -1 : b === 'baseAtk' ? 1 : 0))
    .map(([key, value]) => ({
      key,
      label: statLabel(key),
      text: formatPanelValue(key, displayStat(key, value)),
    }))
})

// The passive at a refinement of the reader's choosing (the copy's to start), and the lore.
const text = shallowRef<WeaponText | null | undefined>()
watch(
  () => [g.value.key, locale.value] as const,
  ([key, lang]) => {
    text.value = undefined
    void import('@gdt/game-data/details')
      .then((m) => m.loadWeaponDetail(key, lang))
      .catch(() => undefined)
      .then((found) => g.value.key === key && (text.value = found ?? null))
  },
  { immediate: true },
)
const refinement = ref(selected.value.refinement)
watch(
  () => selected.value.refinement,
  (r) => (refinement.value = r),
)
const refinable = computed(() => (text.value?.refinements.length ?? 0) > 1)
const refinementOptions = computed(() =>
  Array.from({ length: MAX_REFINEMENT }, (_, i) => ({ value: i + 1, label: `R${i + 1}` })),
)
const passive = computed(() => {
  const found = text.value
  if (!found) return null
  const steps = found.refinements
  const description = steps[Math.min(refinement.value, steps.length) - 1]
  return description ? { name: found.name, description } : null
})
// A bar only for a weapon the capture says is partway into a level.
const expNeed = useExpNeed()
const selectedNeed = computed(() => {
  const w = selected.value
  return w.exp > 0 && w.rarity
    ? (expNeed.value?.weapon(w.rarity, w.level, w.ascension) ?? null)
    : null
})
const equipped = computed(() => g.value.owners.length)
const refinementTitle = (r: number) =>
  t('weapons.detail.refinementTitle', { rank: r, max: MAX_REFINEMENT })
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-4">
      <GameIcon
        :src="weaponIcon(g.key, selected.ascension)"
        :name="g.name"
        :rarity="g.rarity ?? undefined"
        size="lg"
      />
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <p class="flex flex-wrap items-center gap-x-2 text-sm text-text-secondary">
          <RarityStars v-if="g.rarity" :rarity="g.rarity" />
          <span v-if="g.type">{{ WEAPON_TYPE_LABELS[g.type] }}</span>
        </p>
        <p class="flex flex-wrap items-center gap-x-2 text-lg">
          <span
            class="tabular font-mono font-semibold"
            :class="selected.refinement >= MAX_REFINEMENT ? 'text-accent-text' : ''"
            :title="refinementTitle(selected.refinement)"
            >R{{ selected.refinement }}</span
          >
          <span class="text-text-muted" aria-hidden="true">·</span>
          <LevelText :level="selected.level" :ascension="selected.ascension" />
          <ExpProgress v-if="selectedNeed" :exp="selected.exp" :need="selectedNeed" />
        </p>
        <p v-if="!bare" class="flex min-w-0 items-center gap-2 text-sm text-text-secondary">
          <span
            class="inline-flex shrink-0 gap-1"
            role="img"
            :aria-label="refinementTitle(selected.refinement)"
            :title="refinementTitle(selected.refinement)"
          >
            <span
              v-for="n in MAX_REFINEMENT"
              :key="n"
              class="size-2 rotate-45 rounded-[1px]"
              :class="n <= selected.refinement ? 'bg-accent' : 'bg-border-strong'"
            />
          </span>
          <template v-if="selected.location">
            <GameIcon
              :src="characterIcon(selected.location)"
              :name="selected.ownerName"
              size="xs"
              class="rounded-full!"
            />
            <span class="min-w-0 truncate">{{ selected.ownerName }}</span>
          </template>
          <span v-else class="inline-flex items-center gap-1.5">
            <Backpack class="size-4" aria-hidden="true" />
            {{ $t('weapons.detail.unequipped') }}
          </span>
          <Lock
            v-if="selected.lock"
            class="size-4 shrink-0"
            :aria-label="$t('weapons.title.locked')"
          />
        </p>
      </div>
    </div>

    <!-- The weapon's page: stats at this level, the passive per refinement, the lore -->
    <section
      v-if="stats.length || text !== null"
      class="flex flex-col gap-3 rounded-xl border border-border-default bg-surface-base p-3 sm:p-4"
      :aria-label="g.name"
    >
      <dl v-if="stats.length" class="flex flex-wrap gap-x-6 gap-y-1">
        <div v-for="s in stats" :key="s.key" class="flex items-baseline gap-2">
          <dt class="text-sm text-text-secondary">{{ s.label }}</dt>
          <dd class="tabular font-mono font-semibold">{{ s.text }}</dd>
        </div>
      </dl>
      <div v-if="text === undefined" class="h-16 animate-pulse rounded-lg bg-surface-overlay" />
      <template v-else-if="passive">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 class="text-sm font-semibold">{{ passive.name }}</h3>
          <UiSegmented
            v-if="refinable"
            v-model="refinement"
            :options="refinementOptions"
            :label="$t('weapons.detail.refinementTitle', { rank: refinement, max: MAX_REFINEMENT })"
            compact
          />
        </div>
        <GameText :text="passive.description" class="text-sm leading-relaxed" />
      </template>
      <GameText
        v-if="text?.lore"
        :text="text.lore"
        class="border-t border-border-subtle pt-3 text-sm leading-relaxed text-text-muted italic"
      />
    </section>

    <p v-if="!bare" class="flex flex-wrap gap-x-4 text-sm text-text-secondary">
      <i18n-t keypath="weapons.detail.copies" tag="span" :plural="g.count"
        ><template #n
          ><span class="tabular font-mono text-lg text-text-primary">{{
            formatNumber(g.count)
          }}</span></template
        ></i18n-t
      >
      <i18n-t v-if="equipped" keypath="weapons.detail.equipped" tag="span"
        ><template #n
          ><span class="tabular font-mono text-lg text-text-primary">{{ equipped }}</span></template
        ></i18n-t
      >
    </p>

    <ul
      v-if="g.refine"
      class="flex flex-col gap-1 rounded-xl bg-emerald-500/10 px-3 py-2 text-sm"
      :title="$t('weapons.detail.spareCopies', { n: g.refine.spare }, g.refine.spare)"
    >
      <li v-for="t in g.refine.targets" :key="t.owner" class="flex items-center gap-2">
        <ArrowUp class="size-4 text-success-text" aria-hidden="true" />
        <span class="min-w-0 truncate">{{ t.ownerName }}</span>
        <span class="tabular ml-auto flex items-center gap-1 font-mono text-success-text">
          R{{ t.from }}
          <ArrowRight class="size-3.5" aria-hidden="true" />
          <span class="sr-only">{{ $t('characters.timeline.to') }}</span>
          R{{ t.to }}
        </span>
      </li>
    </ul>

    <ul
      v-if="!bare"
      class="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-default"
      :aria-label="$t('weapons.sort.count')"
    >
      <li
        v-for="row in g.rows"
        :key="row.id"
        class="relative flex min-h-11 items-center gap-3 px-3 py-1.5 transition-colors"
        :class="row.id === selected.id ? 'bg-accent/10' : 'hover:bg-surface-overlay/60'"
      >
        <button
          type="button"
          class="absolute inset-0"
          :aria-label="weaponTitle(row)"
          :aria-pressed="row.id === selected.id"
          @click="emit('select', row.id)"
        />
        <LevelText :level="row.level" :ascension="row.ascension" class="w-20 shrink-0" />
        <span
          class="inline-flex shrink-0 items-center gap-1.5"
          :title="refinementTitle(row.refinement)"
        >
          <span
            class="tabular w-6 font-mono"
            :class="row.refinement >= MAX_REFINEMENT ? 'font-semibold text-accent-text' : ''"
            >R{{ row.refinement }}</span
          >
          <span class="hidden gap-1 min-[400px]:inline-flex" aria-hidden="true">
            <span
              v-for="n in MAX_REFINEMENT"
              :key="n"
              class="size-1.5 rotate-45 rounded-[1px]"
              :class="n <= row.refinement ? 'bg-accent' : 'bg-border-strong'"
            />
          </span>
        </span>
        <span class="w-4 shrink-0 text-text-muted">
          <Lock v-if="row.lock" class="size-3.5" :aria-label="$t('weapons.title.locked')" />
        </span>
        <RouterLink
          v-if="row.location"
          :to="{
            name: routeName('account-characters'),
            params: { accountId },
            query: { c: row.location },
          }"
          class="relative z-10 flex min-w-0 flex-1 items-center gap-2 rounded-md hover:text-accent-text"
        >
          <GameIcon
            :src="characterIcon(row.location)"
            :name="row.ownerName"
            size="xs"
            class="rounded-full!"
          />
          <span class="min-w-0 truncate">{{ row.ownerName }}</span>
        </RouterLink>
        <span v-else class="flex-1" />
        <span
          v-if="row.count > 1"
          class="tabular shrink-0 font-mono text-text-secondary"
          :title="$t('weapons.group.copies', { count: formatNumber(row.count) }, row.count)"
          >×{{ formatNumber(row.count) }}</span
        >
      </li>
    </ul>
  </div>
</template>
