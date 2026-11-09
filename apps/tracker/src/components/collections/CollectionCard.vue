<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { ChevronRight } from 'lucide-vue-next'
import UiProgress from '@/components/ui/UiProgress.vue'
import type { CollectionFigure } from '@/data/collection-summary'
import { giCdnArt, imageUrl } from '@/lib/assets'
import { formatNumber } from '@/lib/format'
import { t } from '@/i18n'
import type { CardArt } from './tabs'

/**
 * One card of the Collections hub: the collection's name, its figure (have
 * of total, a percent, or a count with its label), or that it was never captured (when
 * the account last synced is in the top bar). Opens the collection's page.
 * Its game picture (design B4) sits in the top-right corner behind the text,
 * faded toward the bottom-left by a gradient of the card's own ground (no
 * blur, mask or filter: those made scrolling stutter); the ground is
 * `--ground`, so the fade turns with the card on hover.
 */
const props = defineProps<{
  to: RouteLocationRaw
  title: string
  icon: Component
  art?: CardArt
  /** Undefined: the card has no figure (Achievements, Anecdotes count on their page). */
  figure?: CollectionFigure | null
  countLabel?: string
  takenAt?: number | null
}>()

/** The art box from `sm` up and below it, px (the spec's base sizes). */
const BASE = { sm: 112, base: 64 } as const
const artFailed = ref(false)
watch(
  () => props.art?.name,
  () => (artFailed.value = false),
)
const artSrc = computed(() => {
  const art = props.art
  if (!art || artFailed.value) return ''
  return art.cdn ? giCdnArt(art.name) : imageUrl(art.name)
})
const artStyle = computed(() => {
  const art = props.art
  if (!art) return undefined
  const size = (base: number) => {
    if (art.tall) {
      const h = Math.round(base * art.tall.height)
      return [Math.round(h * art.tall.ratio), h]
    }
    const side = Math.round(base * (art.scale ?? 1))
    return [side, side]
  }
  const [w, h] = size(BASE.base)
  const [wSm, hSm] = size(BASE.sm)
  const [top, right] = art.place?.base ?? [8, 8]
  const [topSm, rightSm] = art.place?.sm ?? [12, 12]
  return {
    '--w': `${w}px`,
    '--h': `${h}px`,
    '--w-sm': `${wSm}px`,
    '--h-sm': `${hSm}px`,
    '--top': `${top}px`,
    '--right': `${right}px`,
    '--top-sm': `${topSm}px`,
    '--right-sm': `${rightSm}px`,
    ...(art.rotate ? { transform: `rotate(${art.rotate}deg)` } : {}),
    ...(art.tall?.radius ? { borderRadius: `${art.tall.radius}px` } : {}),
  }
})

const percent = computed(() =>
  props.figure && 'total' in props.figure && props.figure.total > 0
    ? Math.floor((props.figure.have / props.figure.total) * 100)
    : null,
)
</script>

<template>
  <RouterLink
    :to="to"
    class="card group @container flex min-h-32 min-w-0 flex-col gap-2.5 rounded-xl border border-border-default p-3 sm:min-h-40 sm:gap-3 sm:p-4 shadow-sm transition-colors hover:border-border-strong focus-visible:outline-2 focus-visible:outline-accent"
  >
    <img
      v-if="artSrc"
      class="art"
      :src="artSrc"
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      :style="artStyle"
      @error="artFailed = true"
    />
    <span class="veil" aria-hidden="true" />
    <!-- A narrow card (phones, and 3 across at ~1366 px) puts the title under
         the icon row, so a long name keeps the row's width (beside the icon it
         broke mid-word); the chevron right after the title. From sm the rows
         leave the picture's corner free. -->
    <span class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 sm:pr-[104px]">
      <span
        class="grid size-9 shrink-0 place-items-center rounded-lg sm:size-10 bg-accent/15 text-accent-text"
      >
        <component :is="icon" class="size-5" aria-hidden="true" />
      </span>
      <span
        class="order-last flex min-w-0 basis-full items-center gap-1 @min-[360px]:order-none @min-[360px]:flex-1 @min-[360px]:basis-0"
      >
        <span class="line-clamp-2 min-w-0 font-semibold leading-snug break-words">{{ title }}</span>
        <ChevronRight
          class="size-5 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
    </span>

    <span v-if="figure && 'total' in figure" class="mt-auto flex flex-col gap-1.5">
      <span class="flex flex-wrap items-baseline justify-between gap-x-2">
        <span class="text-lg font-semibold tabular-nums sm:text-xl"
          >{{ formatNumber(figure.have)
          }}<span class="text-sm font-normal text-text-muted">
            / {{ formatNumber(figure.total) }}</span
          ></span
        >
        <span class="text-sm text-text-secondary tabular-nums">{{ percent }}%</span>
      </span>
      <UiProgress :value="figure.have" :max="figure.total" :label="title" />
    </span>
    <span v-else-if="figure && 'percent' in figure" class="mt-auto flex flex-col gap-1.5">
      <span class="text-lg font-semibold tabular-nums sm:text-xl"
        >{{ formatNumber(figure.percent)
        }}<span class="text-sm font-normal text-text-muted">%</span></span
      >
      <UiProgress :value="figure.percent" :max="100" :label="title" />
    </span>
    <span v-else-if="figure && 'count' in figure" class="mt-auto flex items-baseline gap-2">
      <span class="text-lg font-semibold tabular-nums sm:text-xl">{{
        formatNumber(figure.count)
      }}</span>
      <span class="truncate text-sm text-text-secondary">{{ countLabel }}</span>
    </span>
    <span v-else class="mt-auto" />

    <span
      v-if="figure !== undefined && takenAt == null"
      class="truncate text-xs text-text-muted"
      :title="t('collections.notCapturedTitle')"
      >{{ t('collections.notCaptured') }}</span
    >
  </RouterLink>
</template>

<style scoped>
.card {
  --ground: var(--color-surface-raised);
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: var(--ground);
}
.card:hover {
  --ground: var(--color-surface-overlay);
}
.art {
  position: absolute;
  z-index: -2;
  top: var(--top);
  right: var(--right);
  width: var(--w);
  height: var(--h);
  object-fit: contain;
  pointer-events: none;
}
/* A narrow card on a phone puts the title on its own row under the icon,
   full width: the picture stays inside the icon row's band so it never
   covers the title or its chevron (the user's report, 2026-11-10). */
@media (max-width: 639.98px) {
  @container (max-width: 359.98px) {
    .art {
      top: 6px;
      right: 8px;
      width: min(var(--w), 72px);
      height: min(var(--h), 42px);
    }
  }
}
@media (min-width: 640px) {
  .art {
    top: var(--top-sm);
    right: var(--right-sm);
    width: var(--w-sm);
    height: var(--h-sm);
  }
}
.veil {
  position: absolute;
  z-index: -1;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(200deg, transparent 40%, var(--ground) 78%);
}
</style>
