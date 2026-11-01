<script setup lang="ts">
import { materialName } from '@/utils/materials'
import type { MaterialKind, PlannerData } from '@gdt/game-data'
import type { CustomCharacter, CustomPreset, CustomWeapon, Good } from '@gdt/shared'
import { computed, reactive, ref, watch } from 'vue'
import { ClipboardPaste, FileUp, Plus, Search } from 'lucide-vue-next'
import MaterialIcon from '@/components/materials-page/MaterialIcon.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { normalizeSearch } from '@/data/characters'
import { gameIcon, materialIcon } from '@/lib/assets'
import { t } from '@/i18n'
import { formatCompact, formatNumber } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import CustomForm from './CustomForm.vue'
import { PresetError, readPreset } from './custom-preset'
import CustomWeaponForm from './CustomWeaponForm.vue'
import { materialSoft } from './material-soft'
import { characterGoalId, itemGoalId } from './model'
import { DEFAULT_PRESET, PRESETS, presetById, type PresetId } from './presets'
import RosterGrid from './RosterGrid.vue'
import WeaponChooser from './WeaponChooser.vue'

type Mode = 'character' | 'weapon' | 'item' | 'custom'

/**
 * Adds goals: several characters at once with one preset (the roster, owned
 * first, with filters), a weapon (any, owned or not; the same one again is
 * another goal), a material for an extra need, or a custom character or
 * weapon (one the game data doesn't have yet), typed in or pasted as a
 * preset (custom-preset.ts; text or a file). Characters and items that have a goal
 * are left out.
 */
const props = defineProps<{
  open: boolean
  /** The game's planner data (no custom characters). */
  planner: PlannerData
  good: Good
  /** Goal ids that exist (`character:Key`, `item:Key`, …). */
  taken: ReadonlySet<string>
  /** The tab it opens on (else the last one used). */
  start?: Mode | null
  saving?: boolean
}>()
const emit = defineEmits<{
  close: []
  characters: [keys: string[], preset: PresetId]
  weapon: [key: string, owner: string]
  item: [key: string]
  custom: [profile: CustomCharacter, preset: PresetId]
  customWeapon: [profile: CustomWeapon]
  preset: [preset: CustomPreset, goalPreset: PresetId]
}>()

const mode = ref<Mode>('character')
const query = ref('')
const selected = ref<Set<string>>(new Set())
const savedPreset = readStorage('planner:preset')
const preset = ref<PresetId>(presetById(savedPreset ?? '')?.id ?? DEFAULT_PRESET)
watch(preset, (value) => writeStorage('planner:preset', value))
const blank = (): CustomCharacter => ({ name: '', rarity: 5, element: 'Pyro', weapon: 'sword' })
const blankWeapon = (): CustomWeapon => ({ name: '', rarity: 5, type: 'sword' })
const custom = reactive<{ profile: CustomCharacter; weapon: CustomWeapon }>({
  profile: blank(),
  weapon: blankWeapon(),
})
type CustomKind = 'character' | 'weapon' | 'paste'
const customKind = ref<CustomKind>('character')
const CUSTOM_KINDS = computed(() => [
  { value: 'character' as const, label: t('planner.custom.character') },
  { value: 'weapon' as const, label: t('planner.custom.weapon') },
  { value: 'paste' as const, label: t('planner.custom.share.paste') },
])

// A pasted (or opened) preset, read as it is typed.
const pasted = ref('')
const reading = computed(() => {
  const text = pasted.value.trim()
  if (!text) return null
  try {
    return { ...readPreset(text, props.planner), error: '' }
  } catch (cause) {
    return { preset: null, unknown: 0, error: cause instanceof PresetError ? cause.message : '' }
  }
})
/** "1 character, 2 weapons": what a preset holds (a part it doesn't have left out). */
function presetCounts(preset: CustomPreset): string {
  const count = (key: string, n: number) =>
    n ? [t(`planner.custom.share.${key}`, { n: formatNumber(n) }, n)] : []
  return [
    ...count('characters', preset.characters.length),
    ...count('weapons', preset.weapons.length),
  ].join(t('farm.craft.listSeparator'))
}
const fileInput = ref<HTMLInputElement>()
async function openFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (fileInput.value) fileInput.value.value = ''
  // A preset is a few KB; anything far bigger isn't one.
  if (file && file.size <= 512 * 1024) pasted.value = await file.text()
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    query.value = ''
    selected.value = new Set()
    custom.profile = blank()
    custom.weapon = blankWeapon()
    pasted.value = ''
    if (props.start) mode.value = props.start
  },
)

const excluded = computed(
  () =>
    new Set(
      [...props.planner.characters.keys()].filter((key) => props.taken.has(characterGoalId(key))),
    ),
)

function toggle(key: string) {
  const next = new Set(selected.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selected.value = next
}

const matches = (name: string) => {
  const q = normalizeSearch(query.value).trim()
  return !q || normalizeSearch(name).includes(q)
}

/** Domain drops first, then bosses, local specialties, enemies, the rest. */
const KIND_ORDER: MaterialKind[] = [
  'book',
  'weapon',
  'gem',
  'boss',
  'weekly',
  'local',
  'common',
  'elite',
  'crown',
  'currency',
  'exp',
  'ore',
  'mora',
]

const materials = computed(() =>
  [...props.planner.materialsByKey.values()]
    .filter((m) => !props.taken.has(itemGoalId(m.key)) && matches(m.name))
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        (a.family?.key ?? a.key).localeCompare(b.family?.key ?? b.key) ||
        a.tier - b.tier,
    )
    .map((m) => ({
      material: m,
      icon: m.key === props.planner.mora.key ? materialIcon('Mora') : gameIcon(m.icon),
      have: props.good.materials[m.key] ?? 0,
    })),
)

const MODES = computed(() => [
  { value: 'character' as const, label: t('planner.picker.characters') },
  { value: 'weapon' as const, label: t('planner.picker.weapons') },
  { value: 'item' as const, label: t('planner.picker.items') },
  { value: 'custom' as const, label: t('planner.card.custom') },
])
const presetOptions = computed(() => PRESETS.map((p) => ({ value: p.id, label: p.label })))
const presetTitle = computed(() => presetById(preset.value)?.title ?? '')

function addCharacters() {
  if (selected.value.size) emit('characters', [...selected.value], preset.value)
}
function addCustom() {
  if (customKind.value === 'paste') {
    const read = reading.value
    if (read?.preset) emit('preset', read.preset, preset.value)
    return
  }
  if (customKind.value === 'weapon') {
    const name = custom.weapon.name.trim()
    if (name) emit('customWeapon', { ...custom.weapon, name })
    return
  }
  const name = custom.profile.name.trim()
  if (name) emit('custom', { ...custom.profile, name }, preset.value)
}
const canAddCustom = computed(() =>
  customKind.value === 'paste'
    ? !!reading.value?.preset
    : (customKind.value === 'weapon' ? custom.weapon.name : custom.profile.name).trim() !== '',
)
</script>

<template>
  <UiModal :open="open" :title="$t('planner.picker.title')" size="wide" @close="emit('close')">
    <div class="flex flex-col gap-3">
      <div class="scroll-hide scroll-fade-x -mx-1 flex overflow-x-auto px-1">
        <UiSegmented v-model="mode" :options="MODES" :label="$t('planner.picker.kind')" />
      </div>

      <RosterGrid
        v-if="mode === 'character'"
        :planner="planner"
        :good="good"
        :selected="selected"
        :exclude="excluded"
        multi
        @toggle="toggle"
      />

      <WeaponChooser
        v-else-if="mode === 'weapon'"
        :planner="planner"
        :good="good"
        @pick="(key, owner) => emit('weapon', key, owner)"
      />

      <div v-else-if="mode === 'custom'" class="flex flex-col gap-4">
        <UiSegmented
          v-model="customKind"
          :options="CUSTOM_KINDS"
          :label="$t('planner.card.custom')"
          class="self-start"
        />
        <CustomForm
          v-if="customKind === 'character'"
          :planner="planner"
          :profile="custom.profile"
          live
          @change="(p) => (custom.profile = p)"
        />
        <CustomWeaponForm
          v-else-if="customKind === 'weapon'"
          :planner="planner"
          :profile="custom.weapon"
          live
          @change="(p) => (custom.weapon = p)"
        />
        <div v-else class="flex flex-col gap-2">
          <textarea
            v-model="pasted"
            rows="8"
            spellcheck="false"
            class="min-h-40 w-full rounded-md border border-border-strong bg-surface-raised p-3 font-code text-xs text-text-primary shadow-sm focus:border-accent focus:ring-2 focus:ring-accent/20 focus:outline-none"
            :aria-label="$t('planner.custom.share.paste')"
            :placeholder="$t('planner.custom.share.placeholder')"
          />
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <UiButton size="sm" @click="fileInput?.click()">
              <FileUp class="size-4" aria-hidden="true" />
              {{ $t('planner.custom.share.file') }}
            </UiButton>
            <input
              ref="fileInput"
              type="file"
              accept=".json,application/json,text/plain"
              class="hidden"
              @change="openFile"
            />
            <span v-if="reading?.preset" class="text-success-text">
              <ClipboardPaste class="inline size-4 align-text-bottom" aria-hidden="true" />
              {{ presetCounts(reading.preset) }}
            </span>
            <span v-else-if="reading" class="text-danger-text">{{
              $t('planner.custom.share.invalid')
            }}</span>
            <span v-if="reading?.unknown" class="text-text-muted">{{
              $t(
                'planner.custom.share.unknown',
                { n: formatNumber(reading.unknown) },
                reading.unknown,
              )
            }}</span>
          </div>
        </div>
      </div>

      <template v-else>
        <label class="relative">
          <span class="sr-only">{{ $t('planner.picker.searchItems') }}</span>
          <Search
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden="true"
          />
          <UiInput
            v-model="query"
            class="pl-9"
            :placeholder="$t('planner.common.search')"
            type="search"
          />
        </label>
        <ul
          class="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1.5"
          :aria-label="$t('planner.picker.items')"
        >
          <li v-for="m in materials" :key="m.material.key">
            <button
              type="button"
              class="flex w-full flex-col items-center gap-1 rounded-lg p-1.5 text-center transition-colors hover:bg-surface-overlay"
              :title="materialName(m.material.key)"
              @click="emit('item', m.material.key)"
            >
              <span
                class="size-12 overflow-hidden rounded-lg text-xs"
                :class="materialSoft(m.material.key, m.material.rarity)"
              >
                <MaterialIcon :src="m.icon" :name="materialName(m.material.key)" />
              </span>
              <span class="line-clamp-2 text-xs leading-tight">{{
                materialName(m.material.key)
              }}</span>
              <span class="tabular font-mono text-[0.6875rem] text-text-muted">{{
                formatCompact(m.have)
              }}</span>
            </button>
          </li>
        </ul>
      </template>
    </div>

    <template v-if="mode === 'character' || mode === 'custom'" #footer>
      <UiSelect
        v-if="mode === 'character' || customKind !== 'weapon'"
        v-model="preset"
        :options="presetOptions"
        class="mr-auto w-36 sm:w-40"
        :aria-label="$t('planner.picker.preset')"
        :title="presetTitle"
      />
      <UiButton class="max-sm:hidden!" @click="emit('close')">{{
        $t('planner.common.cancel')
      }}</UiButton>
      <UiButton
        v-if="mode === 'character'"
        variant="primary"
        :disabled="selected.size === 0"
        :loading="saving"
        @click="addCharacters"
      >
        <Plus class="size-4" aria-hidden="true" />
        {{
          selected.size
            ? $t('planner.picker.addCount', { n: formatNumber(selected.size) })
            : $t('planner.picker.add')
        }}
      </UiButton>
      <UiButton
        v-else
        variant="primary"
        :disabled="!canAddCustom"
        :loading="saving"
        @click="addCustom"
      >
        <Plus class="size-4" aria-hidden="true" />
        {{ $t('planner.picker.add') }}
      </UiButton>
    </template>
  </UiModal>
</template>
