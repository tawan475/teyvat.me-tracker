<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { BookOpen, ChevronLeft } from 'lucide-vue-next'
import type { AccountResponse } from '@gdt/shared'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiModal from '@/components/ui/UiModal.vue'
import { buildPanel, shareUid, talentLevels } from '@/data/character-build'
import { loadBuildIndex } from '@/data/character-builds'
import { useResource } from '@/data/use-resource'
import { useFavoriteCharacters } from '@/data/favorite-characters'
import type { CharacterView } from '@/data/characters'
import { canvasPng } from '@/lib/card-canvas'
import { keyToName } from '@/lib/format'
import { wikiPage } from '@/lib/wiki'
import { useExpNeed } from '@/lib/exp-need'
import { readJson, writeJson } from '@/lib/storage'
import { resolvedTheme } from '@/lib/theme'
import { useCardExport } from '@/lib/use-card-export'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import ShareActions from '@/components/share/ShareActions.vue'
import ShareMenu from '@/components/share/ShareMenu.vue'
import CharacterDetail from './CharacterDetail.vue'
import FavoriteStar from './FavoriteStar.vue'
import { CARD_SCALE, type CardOwner } from './share-card'
import { useCardArt } from './card-art'
import CardArtButton from './CardArtButton.vue'
import { drawShareCard } from './share-card-canvas'
import { expShare } from './share-card-model'
import { useConstellationBoosts, useCrownIcon } from './use-boosts'

/**
 * The character details dialog, which is also the share card. From `lg`
 * the details are the card itself (CharacterDetail `showcase`), and the
 * header carries its options (theme, name, UID) and PNG / Copy / Share; on
 * narrower screens the details stack and one header button opens the same
 * options and actions. The PNG is the card drawn on a canvas at 1920×1080
 * (share-card-canvas), the same at any window size, zoom or aspect ratio,
 * whatever the details show. Options are remembered on this device; the
 * UID is off until asked for (it's personal) and falls back to the newest
 * capture's when the account has none. History's View swaps in a past
 * capture's build (`viewing`) until Back to now or another character.
 */
const props = defineProps<{
  character: CharacterView | null
  account: AccountResponse
  /** From the newest capture (irminsul's gi_player). */
  playerUid: number | null
  ar: number | null
  index?: number
  total: number
  /** Opened from Share build's picker: a Back arrow returns to it. */
  back?: boolean
}>()
const emit = defineEmits<{ close: []; step: [delta: -1 | 1]; back: [] }>()

const showcase = useMediaQuery('(min-width: 1024px)')

// The favourite star beside the name: the page's own list (pinned first), by GOOD key.
const { isFavorite, toggle: toggleFavorite } = useFavoriteCharacters(() => props.account.id)

interface Prefs {
  theme?: 'light' | 'dark'
  name?: boolean
  uid?: boolean
}
const saved = readJson<Prefs>('share-card', {})
const theme = ref<'light' | 'dark'>(saved.theme ?? resolvedTheme.value)
const showName = ref(saved.name ?? true)
const showUid = ref(saved.uid ?? false)
watch([theme, showName, showUid], () =>
  writeJson('share-card', { theme: theme.value, name: showName.value, uid: showUid.value }),
)

// Time travel: the snapshot whose build is on screen (null: now).
const viewing = ref<number | null>(null)
watch(
  () => props.character?.key,
  () => (viewing.value = null),
)
const builds = useResource(
  () => (props.character ? props.account : null),
  (account) => (account ? loadBuildIndex(account) : Promise.resolve(null)),
)
const past = computed(() => {
  const index = builds.data.value
  const key = props.character?.key
  if (viewing.value === null || !index || !key) return null
  const character = index.character(viewing.value, key)
  const capture = index.capture(viewing.value)
  return character && capture ? { character, ...capture } : null
})
// A capture that went away (deleted, or a new data version without it): back to now.
watch(past, (value) => {
  if (!value && viewing.value !== null && builds.data.value) viewing.value = null
})

const c = computed(() => past.value?.character ?? props.character)
const owner = computed<CardOwner>(() => ({
  name: showName.value ? props.account.name : null,
  uid: showUid.value ? shareUid(props.account.uid, props.playerUid) : null,
  // The AR belongs with the name: hidden when the name is.
  ar: showName.value ? props.ar : null,
}))
const takenAt = computed(() => past.value?.at ?? props.account.latest?.takenAt ?? null)
const boosts = useConstellationBoosts(() => c.value?.key ?? '')
const panel = computed(() => (c.value ? buildPanel(c.value) : null))
const talents = computed(() =>
  c.value ? talentLevels(c.value.talent, c.value.constellation, boosts.value) : [],
)

// ------------------------------------------------------------------ export
// Drawn on a canvas on demand (pointing at the actions starts it) and kept until
// something on the card changes (lib/use-card-export).

// The player's own card art for this character (this browser only).
const cardArt = useCardArt(() => c.value?.key ?? null)

const expNeed = useExpNeed()
const crown = useCrownIcon()
const exporter = useCardExport({
  draw: async () => {
    const character = c.value
    if (!character) throw new Error('Closed')
    const drawn = await drawShareCard(
      {
        character,
        panel: panel.value,
        talents: talents.value,
        theme: theme.value,
        owner: owner.value,
        takenAt: takenAt.value,
        past: past.value !== null,
        crown: crown.value,
        levelBar: expShare(
          character.exp,
          expNeed.value?.character(character.level, character.ascension),
        ),
        friendshipBar:
          character.friendship === null
            ? null
            : expShare(character.friendshipExp, expNeed.value?.friendship(character.friendship)),
        art: cardArt.art.value,
      },
      CARD_SCALE,
    )
    return { blob: await canvasPng(drawn.canvas), missing: drawn.missing }
  },
  open: () => c.value !== null,
  state: () => [
    c.value,
    theme.value,
    owner.value,
    takenAt.value,
    boosts.value,
    locale.value,
    crown.value,
    cardArt.art.value,
    expNeed.value,
  ],
  filename: () => {
    const key = c.value?.key ?? 'character'
    if (!past.value) return `${key}-teyvat-me.png`
    const d = new Date(past.value.at)
    const day = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
      .map((n) => String(n).padStart(2, '0'))
      .join('-')
    return `${key}-${day}-teyvat-me.png`
  },
  title: () => c.value?.name ?? t('share.export.buildTitle'),
  pngLabel: () => t('share.export.downloadSized', { size: '1920 × 1080' }),
})

/** The character's Fandom wiki page: its English name (the GOOD key's words; the twins share one page). */
const wikiOf = (key: string) => wikiPage(key.startsWith('Traveler') ? 'Traveler' : keyToName(key))
</script>

<template>
  <UiModal
    :open="character !== null"
    :title="character?.name ?? ''"
    size="detail"
    :index="index"
    :total="total"
    loop
    @close="emit('close')"
    @step="(delta) => emit('step', delta)"
  >
    <template #heading>
      <div class="mr-auto flex min-w-0 flex-1 items-center gap-1">
        <UiIconButton v-if="back" :label="$t('common.back')" class="-ml-2" @click="emit('back')">
          <ChevronLeft class="size-5" aria-hidden="true" />
        </UiIconButton>
        <h2 class="min-w-0 truncate text-lg font-semibold">{{ character?.name ?? '' }}</h2>
        <FavoriteStar
          v-if="character"
          :on="isFavorite(character.key)"
          :name="character.name"
          always
          @toggle="toggleFavorite(character.key)"
        />
      </div>
      <a
        v-if="character"
        :href="wikiOf(character.key)"
        target="_blank"
        rel="noopener"
        class="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-overlay hover:text-text-primary"
        :title="$t('characters.modal.wikiTitle')"
      >
        <BookOpen class="size-4" aria-hidden="true" />
        <span class="max-sm:sr-only">{{ $t('characters.modal.wiki') }}</span>
      </a>
      <CardArtButton v-if="showcase && character" :control="cardArt" />
      <ShareActions
        v-if="showcase"
        v-model:theme="theme"
        v-model:name="showName"
        v-model:uid="showUid"
        :exporter="exporter"
      />
      <ShareMenu
        v-else
        v-model:theme="theme"
        v-model:name="showName"
        v-model:uid="showUid"
        :exporter="exporter"
        :size="$t('characters.modal.pngSize', { size: '1920 × 1080' })"
      />
    </template>

    <CharacterDetail
      v-if="character && c"
      :character="c"
      :now="character"
      :account="account"
      :showcase="showcase"
      :card-theme="theme"
      :owner="owner"
      :taken-at="takenAt"
      :builds="builds.data.value ?? null"
      :viewing="past ? viewing : null"
      :past="past ? { at: past.at, capture: past.capture } : null"
      :art="cardArt.art.value"
      @view="(id) => (viewing = id)"
    />
  </UiModal>
</template>
