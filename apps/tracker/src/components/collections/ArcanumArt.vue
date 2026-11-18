<script setup lang="ts">
/**
 * A Lunar Arcanum's picture. Held (or not known): the card art. Missing:
 * its own art very dark and blurred, the numeral over it as the lock (the
 * user's pick, 2026-11-18), so missing differs in lightness, sharpness and a
 * mark, never by hue alone. Copies beyond the first: a "×2" badge.
 */
withDefaults(
  defineProps<{
    src: string
    numeral: string
    missing: boolean
    count?: number | null
    size?: 'sm' | 'lg'
    /** The picture's box ratio (the card 373×958; the framed one 663×958). */
    ratio?: string
    /** Off for pictures far down a long page (all 22 cards load at once by default: they're small). */
    lazy?: boolean
  }>(),
  { count: null, size: 'sm', ratio: '373 / 958' },
)
</script>

<template>
  <span class="relative block w-full" :style="{ aspectRatio: ratio }">
    <!-- The card's own outline (the art as a mask), filled with its art blurred and darkened. -->
    <span
      v-if="missing"
      class="absolute inset-0 overflow-hidden bg-[#0b1020]"
      :style="{
        maskImage: `url(${src})`,
        maskSize: '100% 100%',
        maskRepeat: 'no-repeat',
      }"
    >
      <img
        :src="src"
        alt=""
        :loading="lazy ? 'lazy' : 'eager'"
        decoding="async"
        data-skeleton="off"
        class="size-full scale-105 object-contain saturate-[.7]"
        :class="size === 'lg' ? 'blur-[5px] brightness-[.6]' : 'blur-[1.5px] brightness-[.6]'"
      />
      <!-- A mild darkening that radiates from the middle, where the numeral sits. -->
      <span
        class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(4,6,16,.5),rgba(4,6,16,0)_72%)]"
        aria-hidden="true"
      />
      <span
        class="absolute inset-0 flex items-center justify-center font-bold tracking-wider text-slate-100 [text-shadow:0_2px_8px_rgba(0,0,0,.7)]"
        :class="
          size === 'lg'
            ? 'text-5xl'
            : numeral.length > 3
              ? 'text-[clamp(0.7rem,2.4vw,1.05rem)]'
              : 'text-[clamp(0.85rem,3vw,1.35rem)]'
        "
        aria-hidden="true"
        >{{ numeral }}</span
      >
    </span>
    <img
      v-else
      :src="src"
      alt=""
      :loading="lazy ? 'lazy' : 'eager'"
      decoding="async"
      class="size-full object-contain"
    />
    <span
      v-if="count && count > 1"
      class="tabular absolute -right-1.5 rounded-full border-[1.5px] border-slate-50 bg-slate-900 font-bold text-slate-50 shadow-[0_2px_6px_rgba(0,0,0,.35)]"
      :class="size === 'lg' ? 'top-0 px-3 py-1 text-base' : 'top-0 px-1.5 py-px text-xs'"
      >×{{ count }}</span
    >
  </span>
</template>
