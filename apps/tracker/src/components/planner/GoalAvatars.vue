<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus } from 'lucide-vue-next'
import { characterMeta, weaponMeta } from '@/data/game-meta'
import { characterIcon, weaponIcon } from '@/lib/assets'
import { t } from '@/i18n'
import { plannerCharacterIcon, plannerWeaponIcon } from './custom-registry'
import { longPress, useGoalActions } from './goal-actions'
import { characterName, weaponName } from './model'

/**
 * Who needs something: goal ids (`character:Key`, `custom:<id>`,
 * `weapon:Key:Owner:<id>`, `item:Key`) as a row of round portraits on
 * their rarity's colour, 36 px and side by side so each face reads, one
 * per character (a weapon goal shows its holder, a spare weapon itself,
 * extra item needs one "+" disc; a custom character its initials),
 * wrapping when the row runs out of room, "+N" past `max`, which shows
 * them all when tapped. On the Planner (goal-actions.ts) each is a
 * button: a tap opens the goal, a long press or right click pauses it;
 * favourites get a gold ring.
 */
const props = withDefaults(defineProps<{ goals: readonly string[]; max?: number }>(), { max: 6 })
const actions = useGoalActions()

interface Person {
  /** The first goal it stands for (what a tap opens). */
  id: string
  src: string
  name: string
  extra: boolean
  favorite: boolean
  rarity: number | null
}

// Literal class names so Tailwind sees them (ItemTile's backdrops).
const BACKDROP: Record<number, string> = {
  5: 'from-rarity-5/45 to-rarity-5/10',
  4: 'from-rarity-4/45 to-rarity-4/10',
  3: 'from-rarity-3/40 to-rarity-3/10',
  2: 'from-rarity-2/40 to-rarity-2/10',
  1: 'from-rarity-1/40 to-rarity-1/10',
}

const people = computed<Person[]>(() => {
  const favorites = actions?.favorites.value
  const customs = actions?.names.value
  const nameOf = (key: string) => customs?.get(key) ?? characterName(key)
  const iconOf = (key: string) => plannerCharacterIcon(key)
  const byKey = new Map<
    string,
    { id: string; src: string; names: string[]; who: string; rarity: number | null }
  >()
  for (const id of props.goals) {
    const [kind, key = '', owner = ''] = id.split(':')
    if (kind === 'item') {
      if (!byKey.has('extra')) {
        byKey.set('extra', {
          id,
          src: '',
          names: [t('planner.extra.title')],
          who: '',
          rarity: null,
        })
      }
      continue
    }
    // A weapon goal shows the character holding it; a spare one, the weapon.
    const own = kind === 'character' || kind === 'custom'
    const who = own ? key : owner
    const name = own ? nameOf(key) : weaponName(key)
    const slot = who ? `c:${who}` : `w:${key}`
    const seen = byKey.get(slot)
    if (seen) {
      seen.names.push(name)
      // A character's own goal opens before its weapon's.
      if (own) seen.id = id
      continue
    }
    byKey.set(slot, {
      id,
      src: who ? iconOf(who) : plannerWeaponIcon(key, 2),
      names: who && !own ? [nameOf(who), name] : [name],
      who,
      rarity: (who ? characterMeta(who) : weaponMeta(key))?.[0] ?? null,
    })
  }
  return [...byKey.entries()].map(([slot, p]) => ({
    id: p.id,
    src: p.src,
    extra: slot === 'extra',
    favorite: !!p.who && !!favorites?.has(p.who),
    name: [...new Set(p.names)].join(' · '),
    rarity: p.rarity,
  }))
})
/** "+N" tapped: every portrait shows. */
const all = ref(false)
watch(
  () => props.goals,
  () => (all.value = false),
)
const shown = computed(() => (all.value ? people.value : people.value.slice(0, props.max)))
const extra = computed(() => people.value.length - shown.value.length)
const names = computed(() => people.value.map((p) => p.name).join(', '))
const rest = computed(() =>
  people.value
    .slice(props.max)
    .map((p) => p.name)
    .join(', '),
)
const hidden = computed(() => people.value.length - props.max)

/** Pictures that failed to load (they show letters). */
const failed = ref<ReadonlySet<string>>(new Set())
function onError(src: string) {
  failed.value = new Set([...failed.value, src])
}

/** Letters for a portrait without a picture (a custom character, a failed load). */
const initials = (name: string) =>
  name
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

/** One long-press tracker per goal shown. */
const presses = new Map<string, ReturnType<typeof longPress>>()
function press(id: string) {
  let p = presses.get(id)
  if (!p) {
    p = longPress(() => {
      navigator.vibrate?.(15)
      actions?.pause(id)
    })
    presses.set(id, p)
  }
  return p
}

function open(id: string) {
  actions?.open(id)
}
</script>

<template>
  <span
    v-if="people.length"
    class="inline-flex min-w-0 flex-wrap items-center gap-1"
    :title="actions ? undefined : names"
  >
    <span v-if="!actions" class="sr-only">{{ names }}</span>
    <span class="flex min-w-0 flex-wrap gap-1" :aria-hidden="actions ? undefined : 'true'">
      <template v-for="p in shown" :key="p.id">
        <component
          :is="actions ? 'button' : 'span'"
          :type="actions ? 'button' : undefined"
          class="relative inline-flex size-9 shrink-0 overflow-hidden rounded-full bg-linear-to-br ring-2 select-none [-webkit-touch-callout:none]"
          :class="[
            p.favorite ? 'ring-rarity-5' : 'ring-surface-raised',
            p.rarity ? BACKDROP[p.rarity] : 'from-surface-overlay to-surface-sunken',
            actions
              ? 'touch-manipulation transition-transform hover:z-10 hover:scale-110 focus-visible:z-10'
              : '',
          ]"
          :aria-label="
            actions
              ? p.favorite
                ? $t('planner.avatars.favorite', { name: p.name })
                : p.name
              : undefined
          "
          :title="actions ? $t('planner.avatars.title', { name: p.name }) : undefined"
          v-on="actions ? press(p.id).handlers : {}"
          @click="actions && open(p.id)"
        >
          <span
            v-if="p.extra"
            class="inline-flex size-full items-center justify-center text-text-secondary"
          >
            <Plus class="size-4" aria-hidden="true" />
          </span>
          <img
            v-else-if="p.src && !failed.has(p.src)"
            :key="p.src"
            loading="lazy"
            decoding="async"
            :src="p.src"
            :alt="p.name"
            class="pointer-events-none size-full object-cover"
            @error="onError(p.src)"
          />
          <span
            v-else
            class="inline-flex size-full items-center justify-center font-mono text-xs text-text-muted"
            >{{ initials(p.name) }}</span
          >
        </component>
      </template>
    </span>
    <button
      v-if="extra > 0"
      type="button"
      class="tabular inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-surface-overlay px-2 font-mono text-xs font-medium text-text-secondary transition-colors hover:bg-surface-sunken hover:text-text-primary"
      :title="$t('planner.avatars.moreTitle', { rest })"
      :aria-label="$t('planner.avatars.moreLabel', { n: extra, rest })"
      @click="all = true"
    >
      +{{ extra }}
    </button>
    <button
      v-else-if="all && hidden > 0"
      type="button"
      class="inline-flex h-9 items-center rounded-full px-2 text-xs text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
      :title="$t('planner.avatars.fewerTitle')"
      @click="all = false"
    >
      {{ $t('planner.avatars.fewer') }}
    </button>
  </span>
</template>
