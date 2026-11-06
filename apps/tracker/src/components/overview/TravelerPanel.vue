<script setup lang="ts">
import type { GiPlayer } from '@gdt/shared'
import { computed, ref, watch } from 'vue'
import { FRAME_HOLE } from '@/data/profile-card'
import { Cake, Compass, Heart, Mountain, Swords, Trophy } from 'lucide-vue-next'
import { dateLocale, formatNumber } from '@/lib/format'

/**
 * The player's card on Overview, design "Shaded panels" (the user's pick,
 * 2026-10-28): the name card covers the whole card; the profile picture (its
 * frame over it), then a name panel (in-game name, signature, UID at its
 * foot) and two stat panels: Adventure Rank (EXP along the row), World
 * Level, Total Achievements; Characters at max Friendship, Spiral Abyss
 * stars, Birthday. Panels share one look (a dark glass, the only backdrop
 * blur on the page). Rows without data are hidden, an empty panel too. The
 * layout follows the card's own width (container queries): wide, laptop
 * (picture + name on the left half, the stats below), phone (stacked).
 * Older captures fall back (`profile`): the account's name, the Traveler's
 * portrait, the default name card.
 */
const props = defineProps<{
  player: GiPlayer
  /** EXP the next rank needs (the game data's AR table); null at AR 60 or unknown. */
  need: number | null
  profile: {
    name: string
    signature: string | null
    /** The name card's picture (a full image URL). */
    nameCard: string
    /** The profile picture (a full image URL), '' for none. */
    avatar: string
    /** Its frame (a full image URL), '' for none. */
    frame: string
    /** The account's UID, null when unknown. */
    uid: string | null
  }
  stats: {
    /** Achievements done (newest capture ∪ hand marks); null until counted. */
    achievements: number | null
    /** Characters at friendship 10; null when the capture has no friendship. */
    maxFriendship: number | null
    /** Spiral Abyss stars this period; null when not captured or out of date. */
    abyssStars: number | null
  }
}>()

// A frame is drawn at the game's own scale around the picture (FRAME_HOLE).
const frameScale = ref<number | null>(null)
watch(
  () => props.profile.frame,
  () => (frameScale.value = null),
)
function frameLoaded(event: Event) {
  const img = event.target as HTMLImageElement
  if (img.naturalWidth > 0) frameScale.value = img.naturalWidth / FRAME_HOLE
}

/** EXP toward the next rank: shown below AR 60 with a known need. */
const exp = computed(() => {
  const value = props.player.arExp
  if (props.need === null || value === undefined) return null
  return { value, need: props.need, share: Math.min(100, (value / props.need) * 100) }
})
const birthday = computed(() => {
  const b = props.player.birthday
  if (!b) return null
  return new Date(2000, b.month - 1, b.day).toLocaleDateString(dateLocale(), {
    month: 'short',
    day: 'numeric',
  })
})
const left = computed(() =>
  [
    props.player.ar === undefined
      ? null
      : { key: 'ar', icon: Compass, label: 'arLabel', value: formatNumber(props.player.ar) },
    props.player.wl === undefined
      ? null
      : { key: 'wl', icon: Mountain, label: 'wl', value: formatNumber(props.player.wl) },
    props.stats.achievements === null
      ? null
      : {
          key: 'achievements',
          icon: Trophy,
          label: 'achievements',
          value: formatNumber(props.stats.achievements),
        },
  ].filter((row) => row !== null),
)
const right = computed(() =>
  [
    props.stats.maxFriendship === null
      ? null
      : {
          key: 'friendship',
          icon: Heart,
          label: 'maxFriendship',
          value: formatNumber(props.stats.maxFriendship),
        },
    props.stats.abyssStars === null
      ? null
      : { key: 'abyss', icon: Swords, label: 'abyss', value: `${props.stats.abyssStars} ★` },
    birthday.value === null
      ? null
      : { key: 'birthday', icon: Cake, label: 'birthday', value: birthday.value },
  ].filter((row) => row !== null),
)
</script>

<template>
  <section class="player-card" :aria-label="$t('overview.traveler.label')">
    <img :src="profile.nameCard" alt="" class="art" />
    <div class="grid-box">
      <div class="head">
        <span class="pfp" aria-hidden="true">
          <img
            v-if="profile.avatar"
            :src="profile.avatar"
            alt=""
            :class="profile.frame ? 'framed' : 'ringed'"
          />
          <img
            v-if="profile.frame"
            :src="profile.frame"
            alt=""
            class="frame"
            data-skeleton="off"
            :style="frameScale ? { '--frame-scale': frameScale } : { visibility: 'hidden' }"
            @load="frameLoaded"
          />
        </span>
        <div class="panel name-panel">
          <p class="name" :title="profile.name">{{ profile.name }}</p>
          <p v-if="profile.signature" class="signature" :title="profile.signature">
            {{ profile.signature }}
          </p>
          <p v-if="profile.uid" class="uid">
            {{ $t('overview.traveler.uid', { uid: profile.uid }) }}
          </p>
        </div>
      </div>

      <dl v-if="left.length" class="panel stats s">
        <div v-for="row in left" :key="row.key" class="row">
          <span class="tile"><component :is="row.icon" class="size-4" aria-hidden="true" /></span>
          <dt class="label">{{ $t(`overview.traveler.${row.label}`) }}</dt>
          <dd
            class="value"
            :title="
              row.key === 'wl' && player.wlLimit !== undefined
                ? $t('overview.traveler.wlLimit', { n: player.wlLimit })
                : row.key === 'ar' && exp
                  ? $t('overview.traveler.arExp', {
                      exp: formatNumber(exp.value),
                      need: formatNumber(exp.need),
                    })
                  : undefined
            "
          >
            <span v-if="row.key === 'ar' && exp" class="exp"
              >{{ formatNumber(exp.value) }} / {{ formatNumber(exp.need) }}</span
            >{{ row.value }}
          </dd>
          <span v-if="row.key === 'ar' && exp" class="bar" aria-hidden="true"
            ><span :style="{ width: `${exp.share}%` }"
          /></span>
        </div>
      </dl>

      <dl v-if="right.length" class="panel stats r">
        <div v-for="row in right" :key="row.key" class="row">
          <span class="tile"><component :is="row.icon" class="size-4" aria-hidden="true" /></span>
          <dt class="label">{{ $t(`overview.traveler.${row.label}`) }}</dt>
          <dd class="value">{{ row.value }}</dd>
        </div>
      </dl>
    </div>
  </section>
</template>

<style scoped>
/* The same in both themes: the art is the card; white text with a shadow. */
.player-card {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-radius: 0.75rem;
  container-type: inline-size;
  color: #fff;
  text-shadow:
    0 1px 3px rgb(2 6 23 / 0.7),
    0 0 12px rgb(2 6 23 / 0.35);
}
.player-card::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: rgb(2 6 23 / 0.1);
}
.art {
  position: absolute;
  inset: 0;
  z-index: -2;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

/* Phone (default): stacked. */
.grid-box {
  display: grid;
  gap: 12px;
  padding: 14px;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: 'h' 's' 'r';
}
.head {
  grid-area: h;
  display: flex;
  gap: 16px;
  min-width: 0;
}
.s {
  grid-area: s;
}
.r {
  grid-area: r;
}

.pfp {
  position: relative;
  flex: none;
  align-self: center;
  width: 88px;
  height: 88px;
}
.pfp img {
  position: absolute;
  object-fit: cover;
}
.pfp .framed {
  inset: 11%;
  width: 78%;
  height: 78%;
  border-radius: 9999px;
}
.pfp .ringed {
  inset: 5%;
  width: 90%;
  height: 90%;
  border-radius: 9999px;
  box-shadow: 0 0 0 3px rgb(255 255 255 / 0.75);
}
/* Centred on the picture at its own scale (FRAME_HOLE): it reaches past the box, as in game. */
.pfp .frame {
  left: 50%;
  top: 50%;
  width: calc(78% * var(--frame-scale, 1));
  height: auto;
  max-width: none;
  transform: translate(-50%, -50%);
  object-fit: contain;
  pointer-events: none;
}

.panel {
  min-width: 0;
  padding: 12px 16px;
  border-radius: 12px;
  background: rgb(2 6 23 / 0.34);
  backdrop-filter: blur(14px);
}
.name-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.name {
  margin: 0;
  overflow: hidden;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.signature {
  margin: 0;
  display: -webkit-box;
  overflow: hidden;
  font-size: 16px;
  white-space: pre-line;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.uid {
  margin: auto 0 0;
  font-size: 14.5px;
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}

.stats {
  margin: 0;
}
.row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 42px;
  font-size: 16px;
}
.tile {
  display: grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgb(255 255 255 / 0.16);
}
.label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.value {
  margin: 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.exp {
  margin-right: 6px;
  font-weight: 400;
  opacity: 0.8;
}
.bar {
  position: absolute;
  left: 42px;
  right: 2px;
  bottom: 4px;
  height: 3px;
  overflow: hidden;
  border-radius: 9999px;
  background: rgb(255 255 255 / 0.22);
}
.bar > span {
  display: block;
  height: 100%;
  border-radius: 9999px;
  background: #fff;
}

/* A phone's row is too narrow for the EXP figures beside the label: the bar and the tooltip keep them. */
@container (max-width: 420px) {
  .exp {
    display: none;
  }
}

/* Laptop: picture and name on the left half, the stat panels side by side below. */
@container (min-width: 640px) {
  .grid-box {
    gap: 16px;
    padding: 16px 24px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-areas: 'h .' 's r';
  }
  .pfp {
    width: 128px;
    height: 128px;
  }
}

/* Wide: picture, name panel beside it, empty space, two stat panels; panels equal (≤ 400 px). */
@container (min-width: 1180px) {
  .grid-box {
    align-items: stretch;
    grid-template-columns: 128px minmax(0, 400px) minmax(16px, 1fr) minmax(0, 400px) minmax(
        0,
        400px
      );
    grid-template-areas: 'p w . s r';
  }
  .head {
    display: contents;
  }
  .pfp {
    grid-area: p;
  }
  .name-panel {
    grid-area: w;
  }
}
</style>
