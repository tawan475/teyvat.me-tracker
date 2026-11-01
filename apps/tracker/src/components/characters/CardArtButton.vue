<script setup lang="ts">
import { ref } from 'vue'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ImagePlus,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import UiPopover from '@/components/ui/UiPopover.vue'
import { t } from '@/i18n'
import { useFeedback } from '@/stores/feedback'
import { ART_SCALE_STEP, ART_STEP, checkPicture, type CardArtControl } from './card-art'

/**
 * The share card's own-art panel (card-art.ts): the player's character art
 * and background (picked from their files, kept in this browser only), or
 * the game's again; arrows move the art and Bigger / Smaller size it (the
 * game's art too). Changes show on the card at once.
 */
const props = defineProps<{ control: CardArtControl }>()
const feedback = useFeedback()

const open = ref(false)
const anchor = ref<HTMLElement | null>(null)
function toggle(event: Event) {
  anchor.value = event.currentTarget as HTMLElement
  open.value = !open.value
}

const files = {
  splash: ref<HTMLInputElement>(),
  background: ref<HTMLInputElement>(),
}
async function pick(part: 'splash' | 'background', event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const check = await checkPicture(file)
  if (check !== 'ok') {
    feedback.toast({ tone: 'danger', title: t(`share.art.${check}`) })
    return
  }
  await props.control.setPicture(part, file)
}

const PARTS = ['splash', 'background'] as const
const MOVES = [
  { label: 'up', icon: ArrowUp, dx: 0, dy: -ART_STEP, area: '[grid-area:1/2]' },
  { label: 'left', icon: ArrowLeft, dx: -ART_STEP, dy: 0, area: '[grid-area:2/1]' },
  { label: 'right', icon: ArrowRight, dx: ART_STEP, dy: 0, area: '[grid-area:2/3]' },
  { label: 'down', icon: ArrowDown, dx: 0, dy: ART_STEP, area: '[grid-area:3/2]' },
] as const
</script>

<template>
  <UiIconButton
    :label="$t('share.art.title')"
    :class="control.custom() ? 'text-accent-text' : ''"
    :aria-expanded="open"
    @click="toggle"
  >
    <ImagePlus class="size-5" aria-hidden="true" />
  </UiIconButton>
  <UiPopover :open="open" :anchor="anchor" :label="$t('share.art.title')" @close="open = false">
    <div
      class="flex w-72 flex-col gap-3 p-3 text-sm"
      @keydown.left.stop
      @keydown.right.stop
      @keydown.up.stop
      @keydown.down.stop
    >
      <section v-for="part in PARTS" :key="part" class="flex flex-col gap-1.5">
        <h3 class="text-xs font-semibold text-text-secondary">{{ $t(`share.art.${part}`) }}</h3>
        <div class="flex flex-wrap gap-2">
          <UiButton size="sm" @click="files[part].value?.click()">
            <ImagePlus class="size-4" aria-hidden="true" />
            {{ $t('share.art.upload') }}
          </UiButton>
          <UiButton
            v-if="control.art.value[part]"
            size="sm"
            variant="ghost"
            @click="control.setPicture(part, null)"
          >
            {{ $t('share.art.useGame') }}
          </UiButton>
          <input
            :ref="files[part]"
            type="file"
            accept="image/*"
            class="hidden"
            @change="pick(part, $event)"
          />
        </div>
      </section>

      <section class="flex flex-col gap-1.5">
        <h3 class="text-xs font-semibold text-text-secondary">{{ $t('share.art.place') }}</h3>
        <div class="flex items-center gap-4">
          <div class="grid grid-cols-3 grid-rows-3 gap-0.5">
            <UiIconButton
              v-for="m in MOVES"
              :key="m.label"
              :class="m.area"
              :label="$t(`share.art.${m.label}`)"
              @click="control.move(m.dx, m.dy)"
            >
              <component :is="m.icon" class="size-4" aria-hidden="true" />
            </UiIconButton>
          </div>
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-1">
              <UiIconButton
                :label="$t('share.art.smaller')"
                @click="control.resize(-ART_SCALE_STEP)"
              >
                <Minus class="size-4" aria-hidden="true" />
              </UiIconButton>
              <span class="tabular w-12 text-center font-mono text-xs text-text-secondary"
                >{{ Math.round(control.art.value.scale * 100) }}%</span
              >
              <UiIconButton :label="$t('share.art.bigger')" @click="control.resize(ART_SCALE_STEP)">
                <Plus class="size-4" aria-hidden="true" />
              </UiIconButton>
            </div>
            <UiButton size="sm" variant="ghost" @click="control.resetPlace()">
              <RotateCcw class="size-4" aria-hidden="true" />
              {{ $t('share.art.reset') }}
            </UiButton>
          </div>
        </div>
      </section>
      <p class="text-xs text-text-muted">{{ $t('share.art.local') }}</p>
    </div>
  </UiPopover>
</template>
