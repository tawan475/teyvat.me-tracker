<script setup lang="ts">
/**
 * Game art behind the top of a page: a faint tilted wall of round images
 * fading into the page's ground (design "Page backdrop", 2026-10-27). It
 * starts right under the top bar and reaches a little past the content on
 * both sides, fading out there (the user: content `xl`, art about `2xl`), so
 * the page's root view (straight inside the shell's content box) must be
 * `relative isolate`; this sits under its content. Made for the Music Game
 * page's song covers, meant for other pages' art later.
 */
defineProps<{ images: readonly string[] }>()
</script>

<template>
  <div class="page-backdrop" aria-hidden="true">
    <div class="wall">
      <img
        v-for="(src, i) in images"
        :key="`${src}-${i}`"
        :src="src"
        alt=""
        loading="lazy"
        data-skeleton="off"
      />
    </div>
    <div class="fade" />
  </div>
</template>

<style scoped>
/* The shell's content box: py-6, lg:py-8 (AppShell); main clips what passes its sides. */
.page-backdrop {
  position: absolute;
  left: -6rem;
  right: -6rem;
  top: -1.5rem;
  height: 560px;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
  mask-image: linear-gradient(90deg, transparent, #000 6rem, #000 calc(100% - 6rem), transparent);
}
@media (min-width: 1024px) {
  .page-backdrop {
    top: -2rem;
  }
}
.wall {
  position: absolute;
  top: -90px;
  left: -40px;
  right: -40px;
  display: grid;
  grid-template-columns: repeat(auto-fill, 84px);
  gap: 18px;
  transform: rotate(-8deg);
  opacity: 0.4;
  mask-image: linear-gradient(100deg, transparent 5%, #000 50%);
}
[data-theme='dark'] .wall {
  opacity: 0.32;
}
.wall img {
  width: 84px;
  height: 84px;
  border-radius: 9999px;
  object-fit: cover;
}
.fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--surface-base) 25%, transparent) 0%,
    var(--surface-base) 92%
  );
}
@media (max-width: 900px) {
  .page-backdrop {
    height: 400px;
  }
  .wall {
    grid-template-columns: repeat(auto-fill, 60px);
    gap: 12px;
  }
  .wall img {
    width: 60px;
    height: 60px;
  }
}
</style>
