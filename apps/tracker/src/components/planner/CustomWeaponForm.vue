<script setup lang="ts">
import type { PlannerData, PlannerMaterial } from '@gdt/game-data'
import { WEAPON_TYPE_KEYS, type CustomWeapon } from '@gdt/shared'
import { computed, ref, watch } from 'vue'
import MaterialIcon from '@/components/materials-page/MaterialIcon.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { WEAPON_TYPE_LABELS } from '@/data/characters'
import { t } from '@/i18n'
import { gameIcon } from '@/lib/assets'
import { familyName } from './custom-character'
import CustomImageInput from './CustomImageInput.vue'
import { customWeaponChoices } from './custom-weapon'
import { materialSoft } from './material-soft'

/**
 * What a custom weapon is: name, rarity, type, picture (an https address)
 * and its three ascension material families, each picked from the game's
 * lists (newest first; "–" until known, which leaves it out of the cost).
 * Changes are emitted like CustomForm's (the name when the field is left,
 * or as typed with `live`).
 */
const props = defineProps<{ planner: PlannerData; profile: CustomWeapon; live?: boolean }>()
const emit = defineEmits<{ change: [profile: CustomWeapon] }>()

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

const set = <K extends keyof CustomWeapon>(key: K, value: CustomWeapon[K]) =>
  emit('change', { ...props.profile, [key]: value })

type Slot = 'ascension' | 'elite' | 'common'
const SLOTS = computed(() =>
  (['ascension', 'elite', 'common'] as const).map((slot) => ({
    slot,
    label: t(`planner.custom.slot.${slot}`),
  })),
)

const options = computed(() => {
  const c = customWeaponChoices(props.planner)
  const list = (families: typeof c.ascensions) => [
    { value: '', label: '–' },
    ...families.map((f) => ({ value: f.key, label: familyName(f) })),
  ]
  return {
    ascension: list(c.ascensions),
    elite: list(c.elites),
    common: list(c.commons),
  } satisfies Record<Slot, { value: string; label: string }[]>
})

/** A family by its top tier (the one a weapon's last ascension asks for). */
function shown(slot: Slot): PlannerMaterial | null {
  const key = props.profile[slot]
  const m = key ? props.planner.materialsByKey.get(key) : undefined
  if (!m) return null
  return m.family?.members.at(-1) ?? m
}

const RARITIES = [
  { value: 3, label: '3★' },
  { value: 4, label: '4★' },
  { value: 5, label: '5★' },
]
const typeOptions = computed(() =>
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
        @update:model-value="set('rarity', $event as 3 | 4 | 5)"
      />
      <UiSelect
        :model-value="profile.type"
        :options="typeOptions"
        class="w-36"
        :aria-label="$t('planner.custom.weaponType')"
        @update:model-value="set('type', $event)"
      />
    </div>
    <CustomImageInput
      :model-value="profile.image"
      :live="live"
      @update:model-value="set('image', $event)"
    />
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
