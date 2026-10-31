<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { t } from '@/i18n'
import { useExpNeed } from '@/lib/exp-need'
import ElementIcon from '@/components/ui/ElementIcon.vue'
import {
  bonusSets,
  buildRv,
  formatPanelValue,
  setBonusTitle,
  talentTitle,
  weaponLines,
  type BuildPanel,
  type DamageKind,
  type StatRow,
  type TalentLevel,
} from '@/data/character-build'
import { SLOT_LABELS, type CharacterView, type SetCount } from '@/data/characters'
import { artifactIcon, artifactSetIcon, characterBanner, weaponIcon } from '@/lib/assets'
import { CRIT_TIER_TEXT, cvTier, rvTier } from '@/lib/crit-tiers'
import { formatDate, formatNumber } from '@/lib/format'
import { levelCap } from '@/lib/level'
import { ROLL_QUALITY_LABEL, type InferredRoll } from '@/utils/artifact-rolls'
import { formatRollValue, formatStatShort, formatStatValue } from '@/utils/artifact-stats'
import { LIGHT_ART, type ArtTone } from './art-tone'
import CardRollBars from './CardRollBars.vue'
import ElementDisc from './ElementDisc.vue'
import GameStars from './GameStars.vue'
import FadeImage from './FadeImage.vue'
import SplashArt from './SplashArt.vue'
import { CONSTELLATION_MAX_STYLE, isMaxConstellation, refinementStyle } from './max-badges'
import { artTone } from './measure-art'
import {
  BAND_EMBLEM,
  CARD_HEIGHT,
  CARD_THEMES,
  CARD_WIDTH,
  EMBLEM_URL,
  RARITY_GRADIENT,
  WEAPON_EMBLEM,
  elementGlow,
  emblemStyle,
  nameSize,
  chipBackground,
  qualityArt,
  splashFull,
  splashPlace,
  type CardOwner,
} from './share-card'
import { cardPieces, expShare, ownerParts } from './share-card-model'
import { useDetailTip, type TipSubject } from './detail-tip'
import { constellationIcons, talentIcons } from './talent-icons'
import { ELEMENT_TEXT } from './tokens'
import { useCrownIcon } from './use-boosts'

/**
 * The build as one 1920×1080 card, after the "Character Showcase Card"
 * design: on the namecard, the splash art fading into it; name, level,
 * friendship and stars, the constellations down the left column's edge, the
 * talents with the owner and the capture date and site at its foot; weapon,
 * the in-game stats and the sets in the middle; the five pieces on the
 * right, both running to the bottom edge. The weapon's tile and each
 * piece's band (main stat, stars, CV and RV left of the icon) carry the
 * game's item header art: its rarity's gradient under the emblem
 * (share-card QUALITY_ART, EMBLEM; from gi-cdn), alike in both themes.
 * The wide character details show it scaled to their width; the PNG is the
 * same card drawn on a canvas (share-card-canvas), which follows this one:
 * a change here is a change there.
 *
 * Its own palette (share-card CARD_THEMES, light or dark whatever the
 * page's), sizes in px (not the page's rem), no viewport breakpoints and no
 * masks with images, so the export draws what the page shows. Details are
 * in tooltips, as elsewhere; in the character details the talents,
 * constellations, weapon, sets, pieces and element show what they do
 * instead (detail-tip).
 */
const props = defineProps<{
  character: CharacterView
  panel: BuildPanel | null
  talents: TalentLevel[]
  theme: 'light' | 'dark'
  owner: CardOwner
  /** When the capture was taken (epoch ms). */
  takenAt: number | null
  /** A past capture's build (History's View): the date reads "Build of …". */
  past?: boolean
}>()

/** Tailwind's rem-based spacing pinned to 4px, so stray utilities don't follow the page's root size. */
const ROOT = computed(() => ({
  ...CARD_THEMES[props.theme],
  ...(chipBackground(props.character.key, props.theme)
    ? { '--card-chip': chipBackground(props.character.key, props.theme) }
    : {}),
  '--spacing': '4px',
  fontSize: '16px',
  width: `${CARD_WIDTH}px`,
  height: `${CARD_HEIGHT}px`,
}))

/** The panels' glass, as the design: translucent fill, shadow and hairline, blur. */
const PANEL =
  'rounded-[22px] bg-(--card-panel) shadow-(--card-panel-shadow) backdrop-blur-[16px] backdrop-saturate-[1.2]'
/** Small text on the art: the theme's chip (translucent, blurred) and hero colour, no shadow. */
const CHIP_TEXT =
  'bg-(--card-chip) text-(--card-hero) shadow-(--card-chip-ring) backdrop-blur-[10px]'
/** Text on the art: the hero colour with its shadow (dark text with a white glow on light cards). */
const HERO = 'text-(--card-hero) [text-shadow:var(--card-hero-shadow)]'
/** The emblem's place over a piece's band and over the weapon's tile (share-card emblemBox). */
const BAND_EMBLEM_STYLE = emblemStyle(BAND_EMBLEM)
const WEAPON_EMBLEM_STYLE = emblemStyle(WEAPON_EMBLEM)

const c = computed(() => props.character)
const splash = computed(() => splashPlace(c.value.key))
const banner = computed(() => characterBanner(c.value.key))
/**
 * A light card writes its name dark with a white glow; where the namecard is
 * dark behind it (art-tone), the name takes the dark card's white instead.
 * The smaller lines sit on backings in the card's theme (CHIP_TEXT).
 */
const tone = ref<ArtTone>(LIGHT_ART)
watch(
  banner,
  (url) => {
    tone.value = LIGHT_ART
    if (url) void artTone(url).then((found) => banner.value === url && (tone.value = found))
  },
  { immediate: true },
)
const ON_DARK_ART = {
  '--card-hero': CARD_THEMES.dark['--card-hero'],
  '--card-hero-shadow': CARD_THEMES.dark['--card-hero-shadow'],
  '--card-chip': CARD_THEMES.dark['--card-chip'],
  '--card-chip-ring': CARD_THEMES.dark['--card-chip-ring'],
}
const headerStyle = computed(() =>
  props.theme === 'light' && tone.value.top ? ON_DARK_ART : undefined,
)
/** The element's glow behind the splash (none for a character without an element). */
const glow = computed(() => (c.value.element ? elementGlow(c.value.element, props.theme) : 'none'))
const glyphs = computed(() => talentIcons(c.value.key))
const constellations = computed(() => constellationIcons(c.value.key))
const crown = useCrownIcon()
const weapon = computed(() => (c.value.weapon ? weaponLines(c.value.weapon) : null))
const cap = computed(() => levelCap(c.value.ascension, c.value.level))
// EXP toward the next level and friendship level, in the tooltips only (the PNG has none).
const expNeed = useExpNeed()
const expText = (exp: number | null, need: number | null | undefined) =>
  exp === null || need == null
    ? ''
    : ` · ${t('game.expProgress', { exp: formatNumber(exp), need: formatNumber(need) })}`
const levelTitle = computed(
  () =>
    t('share.card.levelTitle', {
      level: c.value.level,
      cap: cap.value,
      ascension: c.value.ascension,
    }) + expText(c.value.exp, expNeed.value?.character(c.value.level, c.value.ascension)),
)
const friendshipTitle = computed(() =>
  c.value.friendship === null
    ? ''
    : t('characters.friendship.title', { level: c.value.friendship }) +
      expText(c.value.friendshipExp, expNeed.value?.friendship(c.value.friendship)),
)
/** The bars under the level and friendship (share-card-model expShare). */
const levelBar = computed(() =>
  expShare(c.value.exp, expNeed.value?.character(c.value.level, c.value.ascension)),
)
const friendshipBar = computed(() =>
  c.value.friendship === null
    ? null
    : expShare(c.value.friendshipExp, expNeed.value?.friendship(c.value.friendship)),
)
const weaponCap = computed(() =>
  c.value.weapon ? levelCap(c.value.weapon.ascension, c.value.weapon.level) : 0,
)

const DAMAGE_TEXT: Record<DamageKind, string> = { ...ELEMENT_TEXT, physical: 'text-physical' }

function statTitle(row: StatRow): string {
  const lines = [`${row.label} ${row.text}`]
  if (row.base !== undefined && row.bonus !== undefined) {
    lines.push(`${formatPanelValue(row.key, row.base)} + ${formatPanelValue(row.key, row.bonus)}`)
  }
  if (row.damage && props.panel && props.panel.allDmg > 0) {
    lines.push(t('characters.stats.allDmg', { value: props.panel.allDmg.toFixed(1) }))
  }
  return lines.join('\n')
}

function setTitle(set: SetCount): string {
  return [`${set.name} ×${set.count}`, ...setBonusTitle(set.setKey, set.active)].join('\n')
}

/** Talent level colour: crowned gold first (Enka), then a C3/C5 boost in cyan. */
function talentTone(talent: TalentLevel): string {
  return talent.crowned
    ? 'text-talent-crown'
    : talent.from
      ? 'text-talent-boost'
      : 'text-(--card-text)'
}

/** Four substat lines per piece, empty ones kept, so the rows line up across the five. */
const pieces = computed(() => cardPieces(c.value))
/** The sets listed: 2 pieces or more (a single piece grants nothing). */
const bonus = computed(() => bonusSets(c.value.sets))
const rv = computed(() => buildRv(c.value.artifacts))
const buildRvTone = computed(() =>
  rv.value > 0 ? CRIT_TIER_TEXT[rvTier(rv.value, 'build')] : 'text-(--card-text)',
)
const buildCvTone = computed(() =>
  c.value.cv > 0 ? CRIT_TIER_TEXT[cvTier(c.value.cv, 'build')] : 'text-(--card-text)',
)

function rollTitle(key: string, rolls: readonly InferredRoll[]): string {
  return rolls
    .map((r) => `${formatRollValue(key, r.value)} (${ROLL_QUALITY_LABEL[r.quality]})`)
    .join(' + ')
}

const ownerLine = computed(() => ownerParts(props.owner))

const tip = useDetailTip()
/** A part's tip props (the card's thicker ring), none outside the character details. */
const tipOf = (subject: TipSubject, side = false) =>
  tip?.bind(subject, { ring: 'card', side }) ?? {}
</script>

<template>
  <div
    :data-theme="theme"
    class="relative overflow-hidden bg-(--card-ground) font-sans text-(--card-text) [font-variant-numeric:tabular-nums]"
    :style="ROOT"
  >
    <!-- One picture, back to front: the namecard blurred into atmosphere (it is only
         840×400; oversized so the blur has no edge), a scrim, the element's glow, the
         splash cut-out whole with its shadow, a full-width vignette. No boxes, no masks. -->
    <FadeImage
      :src="banner"
      class="pointer-events-none absolute top-[-40px] left-[-60px] h-[1160px] w-[2040px] max-w-none object-cover [filter:var(--card-namecard-filter)]"
    />
    <div class="absolute inset-0 [background:var(--card-scrim)]" />
    <div class="absolute inset-0" :style="{ background: glow }" />
    <SplashArt
      :character-key="c.key"
      :name="c.name"
      :rarity="c.rarity"
      class="absolute h-[1100px] w-[2200px]"
      :style="{ left: `${splash.left}px`, top: `${splash.top}px` }"
      :full="splashFull(c.key)"
      img-class="object-contain! [filter:var(--card-splash-shadow)]"
    />
    <div class="absolute inset-0 [background:var(--card-vignette)]" />

    <div
      class="absolute inset-[44px_48px_44px_48px] grid grid-cols-[700px_528px_532px] grid-rows-[minmax(0,1fr)] gap-x-[32px]"
    >
      <!-- Left: who, the constellations down its right edge, the talents at its foot -->
      <section
        class="relative flex min-h-0 flex-col justify-between"
        :aria-label="$t('game.character')"
      >
        <div class="flex flex-col gap-[10px]">
          <div class="flex min-w-0 items-center gap-[18px]">
            <span
              v-if="c.element"
              class="inline-flex shrink-0 rounded-full"
              v-bind="tipOf({ kind: 'element' })"
            >
              <ElementIcon :element="c.element" decorative list class="size-[60px]!" />
            </span>
            <!-- The padding (undone by the margin) gives accents and descenders room
                 inside truncate's clip (Xiangling's g was cut). -->
            <h1
              class="m-0 -my-[0.3em] min-w-0 truncate py-[0.3em] leading-none font-bold tracking-[-0.5px]"
              :class="HERO"
              :style="{ fontSize: `${nameSize(c.name)}px`, ...headerStyle }"
            >
              {{ c.name }}
            </h1>
            <span
              class="ml-[6px] shrink-0 rounded-full px-[12px] py-[4px] text-[22px] font-bold"
              :class="
                isMaxConstellation(c.constellation)
                  ? ''
                  : 'bg-(--card-chip) text-(--card-hero) shadow-(--card-chip-ring)'
              "
              :style="isMaxConstellation(c.constellation) ? CONSTELLATION_MAX_STYLE : undefined"
              :title="$t('characters.constellation.title', { level: c.constellation })"
              >C{{ c.constellation }}</span
            >
          </div>
          <!-- Small text on the art sits on a translucent backing in the card's
               theme, so it reads over any art (light or dark, the splash or the namecard).
               A grid: level and friendship share one column width, as wide as the widest
               either can be (an invisible "Lv. 100/100" / "Friendship 10" under each), so
               the box and both bars keep one length whatever the numbers; both bars always
               show, empty when the EXP is unknown (the canvas copy: share-card-canvas levelParts). -->
          <p
            class="grid items-baseline gap-x-[22px] self-start px-[18px] text-[28px]"
            :class="[
              c.friendship !== null ? 'grid-cols-[1fr_auto_1fr]' : 'grid-cols-1',
              CHIP_TEXT,
              'rounded-[20px] py-[10px] leading-[32px]',
            ]"
          >
            <span :title="levelTitle" class="flex flex-col gap-[2px]"
              ><span class="grid"
                ><span class="[grid-area:1/1] whitespace-nowrap"
                  ><span class="font-normal opacity-85">Lv.&nbsp;</span>
                  <span class="font-bold">{{ c.level }}</span
                  ><span class="font-medium opacity-70">/{{ cap }}</span></span
                ><span class="invisible [grid-area:1/1] whitespace-nowrap" aria-hidden="true"
                  ><span class="font-normal">Lv.&nbsp;</span> <span class="font-bold">100</span
                  ><span class="font-medium">/100</span></span
                ></span
              >
              <span
                class="block h-[6px] overflow-hidden rounded-full bg-current/20"
                aria-hidden="true"
                ><span
                  class="block h-full rounded-full bg-[#818cf8]"
                  :style="{ width: `${levelBar ?? 0}%` }"
              /></span>
            </span>
            <template v-if="c.friendship !== null">
              <span class="self-start opacity-50">·</span>
              <span :title="friendshipTitle" class="flex flex-col gap-[2px]"
                ><span class="grid"
                  ><span class="[grid-area:1/1] whitespace-nowrap"
                    ><span class="font-normal opacity-85">{{ $t('game.friendship') }}&nbsp;</span>
                    <span class="font-bold">{{ c.friendship }}</span></span
                  ><span class="invisible [grid-area:1/1] whitespace-nowrap" aria-hidden="true"
                    ><span class="font-normal">{{ $t('game.friendship') }}&nbsp;</span>
                    <span class="font-bold">10</span></span
                  ></span
                >
                <span
                  class="block h-[6px] overflow-hidden rounded-full bg-current/20"
                  aria-hidden="true"
                  ><span
                    class="block h-full rounded-full bg-[#f472b6]"
                    :style="{ width: `${friendshipBar ?? 0}%` }"
                /></span>
              </span>
            </template>
          </p>
          <GameStars v-if="c.rarity" :rarity="c.rarity" :px="34" class="pl-[2px]" />
        </div>

        <ol
          class="absolute top-[150px] right-0 flex flex-col gap-[16px]"
          :aria-label="$t('characters.constellation.title', { level: c.constellation })"
        >
          <li
            v-for="(src, index) in constellations"
            :key="index"
            class="flex rounded-full"
            :title="
              tip
                ? undefined
                : index < c.constellation
                  ? `C${index + 1}`
                  : $t('characters.constellation.lockedTitle', { n: index + 1 })
            "
            v-bind="tipOf({ kind: 'constellation', index }, true)"
          >
            <ElementDisc
              :src="src"
              :element="c.element"
              :px="84"
              :locked="index >= c.constellation"
              :fallback="`C${index + 1}`"
            />
          </li>
        </ol>

        <!-- Talents, then the owner and the capture date with the site, flush with the panels' foot -->
        <div class="flex flex-col gap-[22px]">
          <ul class="flex items-end gap-[30px]" :aria-label="$t('game.talents')">
            <li
              v-for="(t, index) in talents"
              :key="t.key"
              class="flex flex-col items-center gap-[10px] rounded-[24px]"
              :title="tip ? undefined : talentTitle(t)"
              v-bind="tipOf({ kind: 'talent', index })"
            >
              <ElementDisc :src="glyphs[t.key]" :element="c.element" :px="112" :glyph="90" />
              <span
                class="flex h-[40px] items-center gap-[6px] rounded-full bg-(--card-pill) px-[14px]"
                :class="
                  t.crowned
                    ? 'shadow-[inset_0_0_0_2px_var(--talent-crown)]'
                    : t.silver
                      ? 'shadow-[inset_0_0_0_2px_var(--talent-silver)]'
                      : ''
                "
              >
                <FadeImage
                  v-if="t.crowned"
                  :src="crown"
                  :alt="$t('characters.crowned')"
                  class="ml-[-6px] size-[30px]"
                />
                <span class="text-[26px] font-bold" :class="talentTone(t)">{{ t.level }}</span>
              </span>
            </li>
          </ul>
          <div
            class="flex flex-col gap-[2px] self-start rounded-[18px] px-[18px] py-[10px]"
            :class="CHIP_TEXT"
          >
            <p v-if="ownerLine.length" class="flex min-w-0 items-center gap-[12px] text-[22px]">
              <template v-for="(part, index) in ownerLine" :key="index">
                <span v-if="index" class="opacity-60">·</span>
                <span class="truncate" :class="index === 0 && owner.name ? 'font-semibold' : ''">{{
                  part
                }}</span>
              </template>
            </p>
            <p class="flex items-center gap-[10px] text-[16px] whitespace-nowrap opacity-80">
              <template v-if="takenAt">
                <span>{{
                  past
                    ? $t('characters.builds.buildOf', { date: formatDate(takenAt) })
                    : formatDate(takenAt)
                }}</span>
                <span class="opacity-60">·</span>
              </template>
              <span>teyvat.me</span>
            </p>
          </div>
        </div>
      </section>

      <!-- Middle: weapon, stats (they take the height left), sets and the build -->
      <section
        class="flex min-h-0 flex-col gap-[16px]"
        :aria-label="$t('share.card.weaponAndStats')"
      >
        <div
          v-if="c.weapon"
          class="flex items-center gap-[20px] px-[22px] py-[18px]"
          :class="PANEL"
          v-bind="tipOf({ kind: 'weapon' })"
        >
          <!-- The game's header art: the rarity's gradient, the emblem (48%), the icon -->
          <span
            class="relative size-[128px] shrink-0 overflow-hidden rounded-[16px]"
            :style="{ background: RARITY_GRADIENT[c.weapon.rarity ?? 0] ?? 'var(--card-cv-bg)' }"
          >
            <template v-if="qualityArt(c.weapon.rarity)">
              <FadeImage
                :src="qualityArt(c.weapon.rarity)"
                class="absolute inset-0 size-full max-w-none"
              />
              <span class="absolute opacity-48" :style="WEAPON_EMBLEM_STYLE">
                <FadeImage :src="EMBLEM_URL" class="size-full max-w-none" />
              </span>
            </template>
            <FadeImage
              :src="weaponIcon(c.weapon.key, c.weapon.ascension)"
              class="relative size-[128px]"
            />
          </span>
          <div class="flex min-w-0 flex-col gap-[8px]">
            <p
              class="truncate text-[30px] leading-[1.1] font-semibold"
              :title="tip ? undefined : c.weapon.name"
            >
              {{ c.weapon.name }}
            </p>
            <p class="flex items-center gap-[12px] text-[22px]">
              <span
                :title="
                  $t('share.card.levelTitle', {
                    level: c.weapon.level,
                    cap: weaponCap,
                    ascension: c.weapon.ascension,
                  })
                "
                ><span class="text-(--card-muted)">Lv.&nbsp;</span>
                <span class="font-semibold">{{ c.weapon.level }}</span
                ><span class="text-(--card-muted)">/{{ weaponCap }}</span></span
              >
              <span
                class="rounded-[8px] px-[10px] py-[2px] font-bold"
                :style="refinementStyle(c.weapon.refinement)"
                :title="$t('characters.refinementTitle', { value: c.weapon.refinement })"
                >R{{ c.weapon.refinement }}</span
              >
              <GameStars v-if="c.weapon.rarity" :rarity="c.weapon.rarity" :px="22" />
            </p>
            <p v-if="weapon" class="flex flex-wrap gap-x-[22px] text-[24px]">
              <span
                v-for="stat in [weapon.atk, weapon.sub].filter((s) => s !== null)"
                :key="stat.key"
                class="whitespace-nowrap"
                ><span class="text-(--card-muted)"
                  >{{ formatStatShort(stat.key === 'baseAtk' ? 'atk' : stat.key) }}&nbsp;</span
                >
                <span class="font-bold">{{ stat.text }}</span></span
              >
            </p>
          </div>
        </div>
        <div
          v-else
          class="flex h-[164px] shrink-0 items-center justify-center text-[24px] text-(--card-muted)"
          :class="PANEL"
        >
          {{ $t('characters.gap.noWeapon') }}
        </div>

        <div class="flex min-h-0 flex-[1_1_auto] flex-col px-[26px] py-[10px]" :class="PANEL">
          <dl v-if="panel" class="flex flex-1 flex-col">
            <div
              v-for="(row, index) in panel.rows"
              :key="row.key"
              class="flex flex-[1_1_0] items-center gap-[12px]"
              :class="index < panel.rows.length - 1 ? 'border-b border-(--card-rule)' : ''"
              :title="statTitle(row)"
            >
              <dt
                class="flex min-w-0 flex-[1_1_auto] items-center gap-[10px] truncate text-[25px]"
                :class="row.damage ? DAMAGE_TEXT[row.damage] : 'text-(--card-secondary)'"
              >
                <ElementIcon
                  v-if="row.damage && row.damage !== 'physical'"
                  :element="row.damage"
                  decorative
                  list
                  class="size-[26px]!"
                />
                {{ row.label }}
              </dt>
              <dd
                v-if="row.base !== undefined && row.bonus"
                class="text-[23px] font-medium whitespace-nowrap text-(--card-secondary)"
              >
                {{ formatPanelValue(row.key, row.base) }}
                <span class="font-semibold text-(--card-bonus)"
                  >+{{ formatPanelValue(row.key, row.bonus) }}</span
                >
              </dd>
              <dd
                class="min-w-[110px] text-right text-[30px] font-bold"
                :class="row.damage ? DAMAGE_TEXT[row.damage] : ''"
              >
                {{ row.text }}
              </dd>
            </div>
          </dl>
          <p
            v-else
            class="m-auto text-[24px] text-(--card-muted)"
            :title="$t('characters.stats.newerThanData')"
          >
            {{ $t('characters.stats.none') }}
          </p>
        </div>

        <div class="flex flex-col gap-[12px] px-[24px] py-[18px]" :class="PANEL">
          <p
            v-for="{ set, pieces } in bonus"
            :key="set.setKey"
            class="flex items-center gap-[14px] rounded-[10px]"
            :title="tip ? undefined : setTitle(set)"
            v-bind="tipOf({ kind: 'set', setKey: set.setKey })"
          >
            <span class="size-[44px] shrink-0">
              <FadeImage :src="artifactSetIcon(set.setKey)" class="size-full" />
            </span>
            <span class="min-w-0 flex-[1_1_auto] truncate text-[23px]">{{ set.name }}</span>
            <span
              class="min-w-[36px] rounded-[10px] bg-(--card-set-on-bg) px-[10px] py-[2px] text-center text-[22px] font-bold text-(--card-set-on)"
              :title="tip ? undefined : $t('share.card.pieceBonus', { n: pieces })"
              >{{ pieces }}</span
            >
          </p>
          <p v-if="!c.artifactCount" class="text-[22px] text-(--card-muted)">
            {{ $t('characters.detail.noArtifacts') }}
          </p>
          <p
            v-else
            class="flex items-baseline gap-[18px] text-[20px] whitespace-nowrap"
            :class="bonus.length ? 'border-t border-(--card-rule) pt-[10px]' : ''"
          >
            <span class="text-(--card-muted)">{{ $t('characters.detail.build') }}</span>
            <span class="ml-auto" :title="$t('share.card.rvTitle')"
              ><span class="text-(--card-muted)">RV </span
              ><span class="font-bold" :class="buildRvTone">{{ rv }}%</span></span
            >
            <span :title="$t('artifacts.sortTitle.cv')"
              ><span class="text-(--card-muted)">CV </span
              ><span class="font-bold" :class="buildCvTone">{{ c.cv.toFixed(1) }}</span></span
            >
          </p>
        </div>
      </section>

      <!-- Right: the five pieces fill the column -->
      <ol class="flex min-h-0 flex-col gap-[14px]" :aria-label="$t('game.artifacts')">
        <li
          v-for="{ slot, piece, lines, cv, rv, title } in pieces"
          :key="slot"
          class="flex min-h-0 min-w-0 flex-[1_1_0]"
        >
          <article
            v-if="piece"
            class="flex min-w-0 flex-1 items-stretch overflow-hidden"
            :class="PANEL"
            :title="tip ? undefined : title"
            v-bind="tipOf({ kind: 'set', setKey: piece.setKey }, true)"
          >
            <!-- The band: the game's header art (rarity gradient, emblem at 70%), a shade
                 under the text, the icon, the level; the main stat, stars, CV and RV -->
            <div
              class="relative w-[276px] shrink-0 overflow-hidden"
              :style="{ background: RARITY_GRADIENT[piece.rarity] ?? 'var(--card-cv-bg)' }"
            >
              <template v-if="qualityArt(piece.rarity)">
                <FadeImage
                  :src="qualityArt(piece.rarity)"
                  class="absolute inset-0 size-full max-w-none"
                />
                <span class="absolute opacity-70" :style="BAND_EMBLEM_STYLE">
                  <FadeImage :src="EMBLEM_URL" class="size-full max-w-none" />
                </span>
              </template>
              <span
                class="absolute inset-0 bg-[linear-gradient(90deg,rgba(40,20,8,0.22)_0%,rgba(40,20,8,0)_50%)]"
                aria-hidden="true"
              />
              <span class="absolute inset-y-0 right-[8px] flex items-center">
                <FadeImage
                  :src="artifactIcon(piece.setKey, piece.slotKey)"
                  class="size-[168px] [filter:drop-shadow(0_4px_10px_rgba(70,36,6,0.35))]"
                />
              </span>
              <span
                class="absolute right-[10px] bottom-[10px] rounded-[8px] bg-[rgba(30,16,4,0.55)] px-[8px] py-px text-[17px] font-bold text-white"
                >+{{ piece.level }}</span
              >
              <div
                class="relative box-border flex h-full w-[132px] flex-col justify-center gap-[3px] py-[12px] pl-[18px]"
              >
                <span
                  class="text-[18px] font-medium whitespace-nowrap text-[rgba(255,248,235,0.95)] [text-shadow:0_1px_2px_rgba(70,36,6,0.6)]"
                  >{{ formatStatShort(piece.mainStatKey) }}</span
                >
                <span
                  class="text-[38px] leading-[1.05] font-bold whitespace-nowrap text-white [text-shadow:0_1px_3px_rgba(70,36,6,0.6)]"
                  >{{
                    piece.mainStatValue === null
                      ? '—'
                      : formatStatValue(piece.mainStatKey, piece.mainStatValue)
                  }}</span
                >
                <GameStars
                  :rarity="piece.rarity"
                  :px="15"
                  :gap="1"
                  class="pt-[2px] pb-[4px] [filter:drop-shadow(0_1px_1px_rgba(70,36,6,0.5))]!"
                />
                <span class="flex flex-col items-start gap-[4px] text-[16px] whitespace-nowrap">
                  <span
                    class="rounded-[6px] bg-[rgba(30,16,4,0.5)] px-[7px] py-px font-semibold"
                    :class="cv?.top ? 'cv-glow' : ''"
                    :style="{ color: cv?.color }"
                    >CV {{ piece.cv.toFixed(1) }}</span
                  >
                  <span
                    class="rounded-[6px] bg-[rgba(30,16,4,0.5)] px-[7px] py-px font-semibold"
                    :class="rv?.top ? 'cv-glow' : ''"
                    :style="{ color: rv?.color }"
                    >RV {{ piece.rv }}%</span
                  >
                </span>
              </div>
            </div>
            <div
              class="flex min-w-0 flex-[1_1_auto] flex-col justify-around py-[8px] pr-[12px] pl-[18px]"
            >
              <p
                v-for="n in 4"
                :key="n"
                class="flex h-[28px] items-center gap-[8px]"
                :class="lines[n - 1]?.inactive ? 'opacity-45' : ''"
                :title="
                  lines[n - 1] && !lines[n - 1]!.inactive
                    ? rollTitle(lines[n - 1]!.key, lines[n - 1]!.rolls)
                    : lines[n - 1]
                      ? $t('characters.piece.activatesAt4')
                      : undefined
                "
              >
                <template v-if="lines[n - 1]">
                  <span
                    class="min-w-0 flex-[1_1_auto] truncate text-[19px] text-(--card-secondary)"
                    >{{ formatStatShort(lines[n - 1]!.key) }}</span
                  >
                  <span class="text-right text-[21px] font-semibold whitespace-nowrap">{{
                    formatStatValue(lines[n - 1]!.key, lines[n - 1]!.value)
                  }}</span>
                  <CardRollBars :rolls="lines[n - 1]!.inactive ? [] : lines[n - 1]!.rolls" />
                </template>
              </p>
            </div>
          </article>
          <div
            v-else
            class="flex flex-1 items-center justify-center text-[24px] text-(--card-muted)"
            :class="PANEL"
          >
            {{ SLOT_LABELS[slot] }}
          </div>
        </li>
      </ol>
    </div>
  </div>
</template>
