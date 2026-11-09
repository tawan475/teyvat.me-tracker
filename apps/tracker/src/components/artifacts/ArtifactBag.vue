<script setup lang="ts">
import { firstScreen } from '@/lib/first-screen'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { RARITY_TEXT } from '@/components/characters/tokens'
import UiButton from '@/components/ui/UiButton.vue'
import { isNewPiece, type ArtifactRow } from '@/data/artifacts'
import { formatNumber } from '@/lib/format'
import ArtifactTile from './ArtifactTile.vue'

/**
 * The game's artifact bag: dense tiles in rarity groups, each under a
 * sticky header that folds it. Two thousand tiles would be one long task
 * and a heavy page, so each open group renders a screenful and grows as its
 * end comes near (a chunk per frame, as the Materials bag does; "N more"
 * does it by hand), starting over when the list changes.
 */
interface BagGroup {
  rarity: number
  rows: ArtifactRow[]
}

const props = defineProps<{
  groups: BagGroup[]
  /** Rarities whose group is open. */
  open: ReadonlySet<number>
  previous: ReadonlySet<number> | null
}>()
const emit = defineEmits<{ open: [id: number]; toggle: [rarity: number] }>()

const FIRST = 60
const STEP = 60
/** How close (px) a group's end may come to the viewport before it grows. */
const NEAR_PX = 800

/** Tiles rendered per group (FIRST until it grows). */
const limits = ref<Record<number, number>>({})
const limitOf = (rarity: number) => limits.value[rarity] ?? FIRST
// A new list (filter, sort) starts over.
watch(
  () => props.groups,
  () => (limits.value = {}),
)

/** The tiles a wide screen shows first: their pictures load first. */
const first = computed(() =>
  firstScreen(
    visible.value.map((g) => g.shown),
    (row) => row.id,
  ),
)
const visible = computed(() =>
  props.groups.map((g) => {
    const isOpen = props.open.has(g.rarity)
    const count = isOpen ? Math.min(g.rows.length, limitOf(g.rarity)) : 0
    return {
      ...g,
      isOpen,
      shown: count === g.rows.length ? g.rows : g.rows.slice(0, count),
      more: isOpen ? g.rows.length - count : 0,
    }
  }),
)

function grow(rarity: number) {
  limits.value = { ...limits.value, [rarity]: limitOf(rarity) + STEP }
}

// Each incomplete group ends in a sentinel; one near the viewport grows its group after the
// next paint, a chunk at a time while it stays near.
const sentinels = new Map<number, HTMLElement>()
const near = new Set<number>()
let observer: IntersectionObserver | null = null
let frame = 0
let timer: ReturnType<typeof setTimeout> | undefined

function setSentinel(rarity: number, el: unknown) {
  const old = sentinels.get(rarity)
  if (old === el) return
  if (old) {
    observer?.unobserve(old)
    sentinels.delete(rarity)
    near.delete(rarity)
  }
  if (el instanceof HTMLElement) {
    sentinels.set(rarity, el)
    observer?.observe(el)
  }
}

/** One ref function per group, so re-renders don't detach and re-observe its sentinel. */
const sentinelRefs = new Map<number, (el: unknown) => void>()
function sentinelRef(rarity: number) {
  let fn = sentinelRefs.get(rarity)
  if (!fn) {
    fn = (el) => setSentinel(rarity, el)
    sentinelRefs.set(rarity, fn)
  }
  return fn
}

function schedule() {
  if (frame || timer || near.size === 0) return
  frame = requestAnimationFrame(() => {
    frame = 0
    timer = setTimeout(() => {
      timer = undefined
      let grew = false
      for (const rarity of near) {
        const el = sentinels.get(rarity)
        if (el && el.getBoundingClientRect().top < window.innerHeight + NEAR_PX) {
          grow(rarity)
          grew = true
        }
      }
      if (grew) schedule()
    }, 0)
  })
}

onMounted(() => {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const rarity = Number((entry.target as HTMLElement).dataset.rarity)
        if (entry.isIntersecting) near.add(rarity)
        else near.delete(rarity)
      }
      schedule()
    },
    { rootMargin: `${NEAR_PX}px 0px` },
  )
  for (const el of sentinels.values()) observer.observe(el)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  cancelAnimationFrame(frame)
  clearTimeout(timer)
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <section v-for="g in visible" :key="g.rarity" :aria-label="`${g.rarity}★`">
      <h2 class="sticky top-[var(--app-bar-bottom,4rem)] z-10 -mx-1 bg-surface-base px-1">
        <button
          type="button"
          class="flex min-h-10 w-full items-center gap-2 text-sm font-medium"
          :aria-expanded="g.isOpen"
          @click="emit('toggle', g.rarity)"
        >
          <ChevronDown
            class="size-4 shrink-0 text-text-muted transition-transform"
            :class="g.isOpen ? '' : '-rotate-90'"
            aria-hidden="true"
          />
          <span :class="RARITY_TEXT[g.rarity]">{{ g.rarity }}★</span>
          <span class="tabular font-mono text-text-muted">{{ formatNumber(g.rows.length) }}</span>
          <span class="h-px flex-1 bg-border-default" aria-hidden="true" />
        </button>
      </h2>
      <template v-if="g.isOpen">
        <ul
          class="grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-3 pt-2 pb-2 sm:grid-cols-[repeat(auto-fill,minmax(4.75rem,1fr))] sm:gap-4"
        >
          <li v-for="row in g.shown" :key="row.id" class="flex">
            <ArtifactTile
              :row="row"
              :is-new="isNewPiece(row, previous)"
              :priority="first.has(row.id)"
              @open="emit('open', row.id)"
            />
          </li>
        </ul>
        <div
          v-if="g.more > 0"
          :ref="sentinelRef(g.rarity)"
          :data-rarity="g.rarity"
          class="flex justify-center pb-2"
        >
          <UiButton size="sm" @click="grow(g.rarity)">{{
            $t('artifacts.bag.more', { n: formatNumber(g.more) })
          }}</UiButton>
        </div>
      </template>
    </section>
  </div>
</template>
