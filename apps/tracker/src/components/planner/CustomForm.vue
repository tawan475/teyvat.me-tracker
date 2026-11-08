<script setup lang="ts">
import type { PlannerData, PlannerMaterial } from '@gdt/game-data'
import { ELEMENT_KEYS, WEAPON_TYPE_KEYS, type CustomCharacter } from '@gdt/shared'
import { computed, ref, watch } from 'vue'
import MaterialIcon from '@/components/materials-page/MaterialIcon.vue'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { ELEMENT_LABELS, WEAPON_TYPE_LABELS } from '@/data/characters'
import { toElement } from '@/data/game-meta'
import { t } from '@/i18n'
import { gameIcon } from '@/lib/assets'
import { customChoices, familyName } from './custom-character'
import CustomImageInput from './CustomImageInput.vue'
import { materialSoft } from './material-soft'

/**
 * What a custom character is: name, rarity, element, weapon type, picture
 * (an https address) and its materials, each picked from the game's lists
 * (newest first; "–" until
 * known, which leaves it out of the cost). Every change is emitted at once
 * but the name's, which goes when the field is left (or on Enter); `live`
 * sends it as typed (a form that is saved by a button).
 */
const props = defineProps<{ planner: PlannerData; profile: CustomCharacter; live?: boolean }>()
const emit = defineEmits<{ change: [profile: CustomCharacter] }>()

const name = ref(props.profile.name)
watch(
  () => props.profile.name,
  (value) => (name.value = value),
)
function onName() {
  if (props.live) emit('change', { ...props.profile, name: name.value })
}
function commitName() {
  const value = name.value.trim().slice(0, 40)
  if (value && value !== props.profile.name) emit('change', { ...props.profile, name: value })
  else name.value = props.profile.name
}

const set = <K extends keyof CustomCharacter>(key: K, value: CustomCharacter[K]) =>
  emit('change', { ...props.profile, [key]: value })

const choices = computed(() => customChoices(props.planner))

type Slot = 'book' | 'common' | 'boss' | 'local' | 'weekly'
const SLOTS = computed(() =>
  (['book', 'common', 'boss', 'local', 'weekly'] as const).map((slot) => ({
    slot,
    label: t(`planner.custom.slot.${slot}`),
  })),
)

const options = computed(() => {
  const c = choices.value
  const none = { value: '', label: '–' }
  const list = (items: { value: string; label: string }[]) => [none, ...items]
  return {
    book: list(c.books.map((f) => ({ value: f.key, label: familyName(f) }))),
    common: list(c.commons.map((f) => ({ value: f.key, label: familyName(f) }))),
    boss: list(c.bosses.map((m) => ({ value: m.key, label: m.name }))),
    local: list(c.locals.map((m) => ({ value: m.key, label: m.name }))),
    weekly: list(c.weeklies.map((m) => ({ value: m.key, label: m.name }))),
  } satisfies Record<Slot, { value: string; label: string }[]>
})

/** The material a slot shows: a family by its middle tier (the one the game shows most). */
function shown(slot: Slot): PlannerMaterial | null {
  const key = props.profile[slot]
  const m = key ? props.planner.materialsByKey.get(key) : undefined
  if (!m) return null
  const members = m.family?.members
  return members && (slot === 'book' || slot === 'common') ? (members.at(-1) ?? m) : m
}

const RARITIES = [
  { value: 4, label: '4★' },
  { value: 5, label: '5★' },
]
const weaponOptions = computed(() =>
  WEAPON_TYPE_KEYS.map((w) => ({ value: w, label: WEAPON_TYPE_LABELS[w] })),
)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-end gap-3">
      <label class="flex min-w-0 flex-1 basis-48 flex-col gap-1">
        <span class="text-sm text-text-secondary">{{ $t('planner.custom.name') }}</span>
        <UiInput
          v-model="name"
          maxlength="40"
          :placeholder="$t('planner.custom.name')"
          :invalid="name.trim() === ''"
          @input="onName"
          @change="commitName"
          @keydown.enter="commitName"
        />
      </label>
      <UiSegmented
        :model-value="profile.rarity"
        :options="RARITIES"
        :label="$t('planner.custom.rarity')"
        @update:model-value="set('rarity', $event as 4 | 5)"
      />
      <UiSelect
        :model-value="profile.weapon"
        :options="weaponOptions"
        class="w-36"
        :aria-label="$t('planner.custom.weaponType')"
        @update:model-value="set('weapon', $event)"
      />
    </div>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <CustomImageInput
        :model-value="profile.image"
        :live="live"
        @update:model-value="set('image', $event)"
      />
      <CustomImageInput
        :model-value="profile.banner"
        :live="live"
        :label="$t('planner.custom.banner')"
        @update:model-value="set('banner', $event)"
      />
    </div>
    <div
      class="flex flex-wrap gap-1.5"
      role="radiogroup"
      :aria-label="$t('planner.custom.element')"
    >
      <FilterChip
        v-for="e in ELEMENT_KEYS"
        :key="e"
        radio
        :pressed="profile.element === e"
        @toggle="set('element', e)"
      >
        <ElementIcon :element="toElement(e)!" decorative size="sm" />
        {{ ELEMENT_LABELS[toElement(e)!] }}
      </FilterChip>
    </div>
    <div class="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      <label v-for="s in SLOTS" :key="s.slot" class="flex items-center gap-2.5">
        <span
          class="size-10 shrink-0 overflow-hidden rounded-lg text-[0.625rem]"
          :class="
            shown(s.slot)
              ? materialSoft(shown(s.slot)!.key, shown(s.slot)!.rarity)
              : 'bg-surface-sunken'
          "
        >
          <MaterialIcon
            v-if="shown(s.slot)"
            :src="gameIcon(shown(s.slot)!.icon)"
            :name="shown(s.slot)!.name"
          />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-xs text-text-muted">{{ s.label }}</span>
          <UiSelect
            :model-value="profile[s.slot] ?? ''"
            :options="options[s.slot]"
            :aria-label="s.label"
            @update:model-value="set(s.slot, ($event as string) || undefined)"
          />
        </span>
      </label>
    </div>
  </div>
</template>
