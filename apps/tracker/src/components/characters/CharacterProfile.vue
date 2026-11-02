<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, ExternalLink, Lock } from 'lucide-vue-next'
import GameText from '@/components/game/GameText.vue'
import UiError from '@/components/ui/UiError.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { loadProfile, type CharacterProfile } from '@/data/character-profile'
import { travelerGender } from '@/lib/assets'
import { useResource } from '@/data/use-resource'
import { locale } from '@/i18n/locale'
import { formatMonthDay, keyToName } from '@/lib/format'
import { readStorage, writeStorage } from '@/lib/storage'
import { wikiPage } from '@/lib/wiki'

/**
 * The character's profile (the game's Profile page, design "1" of the
 * new-features canvas): title, birthday, affiliation, Vision, constellation,
 * voice actors, the description, then the stories, each with the Friendship
 * level that unlocks it. A story the account hasn't reached is blurred
 * until "Show locked text" (per device); one without the account's
 * friendship (not owned) reads as is.
 */
const props = defineProps<{
  characterKey: string
  name: string
  /** The account's Friendship level with them; null when not known (not owned). */
  friendship: number | null
}>()

const profile = useResource(
  () => `${props.characterKey}:${locale.value}:${travelerGender()}`,
  () => loadProfile(props.characterKey, locale.value, travelerGender()),
)
const p = computed<CharacterProfile | null | undefined>(() => profile.data.value)

const SHOW_KEY = 'characters:profile-locked'
const showLocked = ref(readStorage(SHOW_KEY) === '1')
watch(showLocked, (value) => writeStorage(SHOW_KEY, value ? '1' : null))

const open = ref<Set<number>>(new Set([0]))
watch(
  () => props.characterKey,
  () => (open.value = new Set([0])),
)
function toggle(index: number) {
  const next = new Set(open.value)
  if (!next.delete(index)) next.add(index)
  open.value = next
}
const locked = (need: number) => props.friendship !== null && need > props.friendship
const unlockedCount = computed(
  () => p.value?.stories.filter((story) => !locked(story.friendship)).length ?? 0,
)

const info = computed(() => {
  const v = p.value
  if (!v) return []
  return [
    ['title', v.title],
    // Any leap year: a birthday on Feb 29 still shows.
    [
      'birthday',
      v.birthday
        ? formatMonthDay(new Date(2000, v.birthday.month - 1, v.birthday.day).getTime())
        : '',
    ],
    ['affiliation', v.affiliation],
    ['vision', v.vision],
    ['constellation', v.constellation],
  ].filter((row): row is [string, string] => !!row[1])
})
const voices = computed(() => {
  const v = p.value?.voice
  if (!v) return []
  return (['en', 'zh', 'ja', 'ko'] as const)
    .map((lang) => [lang, v[lang]] as const)
    .filter(([, name]) => !!name)
})
// The GOOD key is the English name without spaces (the Traveler's twins share one page).
const wiki = computed(() =>
  wikiPage(props.characterKey.startsWith('Traveler') ? 'Traveler' : keyToName(props.characterKey)),
)
</script>

<template>
  <UiError
    v-if="profile.error.value"
    :error="profile.error.value"
    :title="$t('characters.profile.loadFailed')"
    @retry="profile.reload"
  />
  <div
    v-else-if="p === undefined && !profile.data.value"
    class="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]"
    aria-busy="true"
  >
    <UiSkeleton class="h-72" />
    <UiSkeleton class="h-96" />
  </div>
  <p v-else-if="!p" class="text-sm text-text-muted">{{ $t('characters.profile.none') }}</p>
  <div v-else class="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
    <aside
      class="flex flex-col gap-4 rounded-xl border border-border-default bg-surface-raised p-4"
    >
      <h3 class="text-xs font-semibold tracking-wide text-text-muted uppercase">
        {{ $t('characters.profile.info') }}
      </h3>
      <dl class="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
        <template v-for="[key, value] in info" :key="key">
          <dt class="text-text-muted">{{ $t(`characters.profile.fields.${key}`) }}</dt>
          <dd class="min-w-0 break-words">{{ value }}</dd>
        </template>
      </dl>
      <template v-if="voices.length">
        <div class="h-px bg-border-default" />
        <h3 class="text-xs font-semibold tracking-wide text-text-muted uppercase">
          {{ $t('characters.profile.voice') }}
        </h3>
        <dl class="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-sm">
          <template v-for="[lang, who] in voices" :key="lang">
            <dt class="text-text-muted">{{ $t(`characters.profile.voices.${lang}`) }}</dt>
            <dd class="min-w-0 break-words">{{ who }}</dd>
          </template>
        </dl>
      </template>
      <a
        :href="wiki"
        target="_blank"
        rel="noopener"
        class="mt-auto inline-flex items-center gap-1.5 text-sm text-accent-text hover:underline"
      >
        {{ $t('characters.profile.wiki') }}
        <ExternalLink class="size-3.5" aria-hidden="true" />
      </a>
    </aside>

    <section class="flex min-w-0 flex-col gap-3" :aria-label="$t('characters.profile.stories')">
      <GameText
        v-if="p.description"
        :text="p.description"
        class="text-sm leading-relaxed text-text-secondary"
      />
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 class="text-xs font-semibold tracking-wide text-text-muted uppercase">
          {{ $t('characters.profile.stories') }}
        </h3>
        <span v-if="friendship !== null" class="text-xs text-text-muted">{{
          $t('characters.profile.unlocked', { n: unlockedCount, total: p.stories.length })
        }}</span>
        <UiSwitch
          v-if="friendship !== null && unlockedCount < p.stories.length"
          v-model="showLocked"
          class="ml-auto"
          :label="$t('characters.profile.showLocked')"
        />
      </div>
      <div
        v-for="(story, i) in p.stories"
        :key="i"
        class="overflow-hidden rounded-xl border border-border-default bg-surface-raised"
      >
        <button
          type="button"
          class="flex min-h-12 w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-medium hover:bg-surface-overlay/50"
          :aria-expanded="open.has(i)"
          @click="toggle(i)"
        >
          <ChevronRight
            class="size-4 shrink-0 text-text-muted transition-transform"
            :class="open.has(i) ? 'rotate-90' : ''"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 truncate">{{ story.title }}</span>
          <span
            v-if="locked(story.friendship)"
            class="inline-flex shrink-0 items-center gap-1 rounded-full border border-warning-text/60 px-2 py-0.5 text-xs font-semibold text-warning-text"
          >
            <Lock class="size-3" aria-hidden="true" />{{
              $t('characters.profile.friendship', { n: story.friendship })
            }}
          </span>
          <span v-else-if="story.friendship > 0" class="shrink-0 text-xs text-text-muted">{{
            $t('characters.profile.friendship', { n: story.friendship })
          }}</span>
        </button>
        <div v-if="open.has(i)" class="flex flex-col gap-2 px-4 pb-4 pl-10">
          <p v-if="!story.friendship && story.unlock.length" class="text-xs text-text-muted">
            {{ story.unlock.join(' · ') }}
          </p>
          <GameText
            :text="story.text"
            class="text-sm leading-relaxed text-text-secondary"
            :class="locked(story.friendship) && !showLocked ? 'blur-[5px] select-none' : ''"
            :aria-hidden="locked(story.friendship) && !showLocked ? 'true' : undefined"
          />
        </div>
      </div>
    </section>
  </div>
</template>
