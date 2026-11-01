<script setup lang="ts">
import { computed, ref } from 'vue'
import { characterMeta, weaponMeta } from '@/data/game-meta'
import { characterIcon, weaponIcon } from '@/lib/assets'
import { t } from '@/i18n'
import { plannerCharacterIcon, plannerWeaponIcon } from './custom-registry'
import type { FarmPerson } from './farm-groups'
import { useGoalActions } from './goal-actions'
import { characterName, weaponName } from './model'

/**
 * Everyone the Farm view's plan is for (Seelie's strip): one round portrait
 * per character (a spare weapon its own) on one row that scrolls sideways.
 * A tap narrows the cards to that one (`v-model`, a `goalSlot`), again shows
 * everyone. Portraits as GoalAvatars draws them.
 */
const props = defineProps<{ people: readonly FarmPerson[] }>()
const selected = defineModel<string | null>({ required: true })
const actions = useGoalActions()

// Literal class names so Tailwind sees them (GoalAvatars' backdrops).
const BACKDROP: Record<number, string> = {
  5: 'from-rarity-5/45 to-rarity-5/10',
  4: 'from-rarity-4/45 to-rarity-4/10',
  3: 'from-rarity-3/40 to-rarity-3/10',
  2: 'from-rarity-2/40 to-rarity-2/10',
  1: 'from-rarity-1/40 to-rarity-1/10',
}

const shown = computed(() => {
  const customs = actions?.names.value
  return props.people.map((p) => {
    // `c:<character>` or `w:<weapon>`.
    const kind = p.slot.slice(0, 1)
    const key = p.slot.slice(2)
    const name = kind === 'w' ? weaponName(key) : (customs?.get(key) ?? characterName(key))
    return {
      slot: p.slot,
      name,
      src: kind === 'w' ? plannerWeaponIcon(key, 2) : plannerCharacterIcon(key),
      rarity: (kind === 'w' ? weaponMeta(key) : characterMeta(key))?.[0] ?? null,
    }
  })
})

/** Pictures that failed to load (they show letters). */
const failed = ref<ReadonlySet<string>>(new Set())
function onError(src: string) {
  failed.value = new Set([...failed.value, src])
}

const initials = (name: string) =>
  name
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || name.slice(0, 1)

function toggle(slot: string) {
  selected.value = selected.value === slot ? null : slot
}
const titleOf = (slot: string, name: string) =>
  selected.value === slot ? t('farm.people.all', { name }) : t('farm.people.only', { name })
</script>

<template>
  <div
    v-if="shown.length"
    class="scroll-hide scroll-fade-x -mx-1 flex min-w-0 gap-1.5 overflow-x-auto px-1 py-1"
    role="group"
    :aria-label="$t('farm.people.label')"
  >
    <button
      v-for="p in shown"
      :key="p.slot"
      type="button"
      class="relative inline-flex size-10 shrink-0 overflow-hidden rounded-full bg-linear-to-br ring-2 transition-[opacity,box-shadow] select-none"
      :class="[
        p.rarity ? BACKDROP[p.rarity] : 'from-surface-overlay to-surface-sunken',
        selected === p.slot ? 'ring-accent' : 'ring-surface-raised',
        selected !== null && selected !== p.slot ? 'opacity-45 hover:opacity-100' : '',
      ]"
      :aria-pressed="selected === p.slot"
      :aria-label="p.name"
      :title="titleOf(p.slot, p.name)"
      @click="toggle(p.slot)"
    >
      <img
        v-if="p.src && !failed.has(p.src)"
        :key="p.src"
        loading="lazy"
        decoding="async"
        :src="p.src"
        alt=""
        class="pointer-events-none size-full object-cover"
        @error="onError(p.src)"
      />
      <span
        v-else
        class="inline-flex size-full items-center justify-center font-mono text-xs text-text-muted"
        >{{ initials(p.name) }}</span
      >
    </button>
  </div>
</template>
