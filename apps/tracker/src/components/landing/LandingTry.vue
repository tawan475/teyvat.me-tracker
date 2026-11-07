<script setup lang="ts">
/**
 * The landing's "Try it" button (the user's pick 1B, 2026-11-08): one button
 * that opens the two ways to look around without signing up, the demo and
 * guest mode, so the hero's buttons stay on one line. Signed-in visitors
 * only get the demo, as a plain button.
 */
import { ChevronDown } from 'lucide-vue-next'
import { onBeforeUnmount, ref, watch } from 'vue'
import { useSession } from '@/stores/session'

const session = useSession()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

function onPointer(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node)) open.value = false
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}
watch(open, (now) => {
  if (now) {
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
  } else {
    document.removeEventListener('pointerdown', onPointer)
    document.removeEventListener('keydown', onKey)
  }
})
onBeforeUnmount(() => (open.value = false))
</script>

<template>
  <RouterLink
    v-if="session.status === 'signed-in'"
    :to="{ name: 'demo-overview' }"
    class="btn btn-g"
    :title="$t('demo.tryHint')"
  >
    {{ $t('demo.try') }}
  </RouterLink>
  <div v-else ref="root" class="try">
    <button
      type="button"
      class="btn btn-g"
      :class="{ on: open }"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="open = !open"
    >
      {{ $t('landing.hero.tryIt') }}
      <ChevronDown class="ic chev" :class="{ up: open }" aria-hidden="true" />
    </button>
    <div v-if="open" class="menu" role="menu">
      <RouterLink
        :to="{ name: 'demo-overview' }"
        class="item"
        role="menuitem"
        @click="open = false"
      >
        <b>{{ $t('demo.try') }}</b>
        <small>{{ $t('demo.tryHint') }}</small>
      </RouterLink>
      <RouterLink
        :to="{ name: 'guest-overview' }"
        class="item"
        role="menuitem"
        @click="open = false"
      >
        <b>{{ $t('guest.try') }}</b>
        <small>{{ $t('guest.tryHint') }}</small>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.try {
  position: relative;
  display: inline-flex;
}
.btn.on {
  box-shadow: inset 0 0 0 1px #a5b4fc;
}
.chev {
  transition: transform 150ms;
}
.chev.up {
  transform: rotate(180deg);
}
.menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 20;
  width: min(340px, calc(100vw - 36px));
  display: flex;
  flex-direction: column;
  padding: 6px;
  border-radius: 16px;
  background: #1e293b;
  box-shadow:
    inset 0 0 0 1px rgba(255, 255, 255, 0.12),
    0 20px 40px rgba(0, 0, 0, 0.5);
}
.item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 11px 14px;
  border-radius: 11px;
  color: #ffffff;
  text-decoration: none;
}
.item:hover,
.item:focus-visible {
  background: #334155;
}
.item small {
  color: #94a3b8;
  font-size: 13.5px;
  line-height: 1.35;
}
/* Phones stack the hero's buttons full width (landing.css, 720px). */
@media (max-width: 720px) {
  .try {
    flex: 1 1 100%;
  }
  .try .btn {
    width: 100%;
  }
  .menu {
    width: 100%;
  }
}
@media (prefers-reduced-motion: reduce) {
  .chev {
    transition: none;
  }
}
</style>
