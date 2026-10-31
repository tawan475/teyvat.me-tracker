<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import { talentTitle, type TalentLevel } from '@/data/character-build'
import type { Element } from '@/data/game-meta'
import TalentGlyph from './TalentGlyph.vue'
import { talentIcons } from './talent-icons'
import { useDetailTip } from './detail-tip'
import { ELEMENT_SOFT, ELEMENT_TEXT } from './tokens'
import { useCrownIcon } from './use-boosts'

/**
 * Attack, skill and burst as three tiles: the talent's icon and name, its
 * level as the game shows it and, raised by C3 / C5, the book level before
 * it ("10 → 13", Enka's way, in cyan). A crowned talent (base 10) is
 * gold with the game's Crown of Insight, whether raised or not; base 9 has
 * a silver border. In the character details each shows what it does
 * (detail-tip).
 */
const props = defineProps<{
  characterKey: string
  levels: TalentLevel[]
  element: Element | null
}>()

const label = (key: TalentLevel['key']) => t(`characters.talentShort.${key}`)

const glyphs = computed(() => talentIcons(props.characterKey))
const crown = useCrownIcon()
const tip = useDetailTip()
const tone = computed(() =>
  props.element
    ? `${ELEMENT_SOFT[props.element]} ${ELEMENT_TEXT[props.element]}`
    : 'bg-surface-overlay text-text-secondary',
)
</script>

<template>
  <dl class="grid grid-cols-3 gap-2">
    <div
      v-for="(t, index) in levels"
      :key="t.key"
      class="flex min-w-0 flex-col gap-1 rounded-xl border bg-surface-raised/85 px-2 py-1.5 sm:px-2.5 sm:py-2"
      :class="
        t.crowned
          ? 'border-talent-crown/60'
          : t.silver
            ? 'border-talent-silver'
            : 'border-border-default'
      "
      :title="tip ? undefined : talentTitle(t)"
      v-bind="tip?.bind({ kind: 'talent', index }) ?? {}"
    >
      <dt class="flex min-w-0 items-center gap-1.5 text-xs text-text-secondary">
        <span
          v-if="glyphs[t.key]"
          class="hidden size-5 shrink-0 items-center justify-center rounded-full min-[400px]:inline-flex"
          :class="tone"
        >
          <TalentGlyph :key="glyphs[t.key]" :src="glyphs[t.key]" class="size-4" />
        </span>
        <span class="truncate">{{ label(t.key) }}</span>
      </dt>
      <dd
        class="tabular flex items-baseline gap-0.5 font-mono leading-tight whitespace-nowrap sm:gap-1"
      >
        <span v-if="t.from" class="text-xs text-text-muted"
          >{{ t.base }}<span aria-hidden="true"> →</span
          ><span class="sr-only"> {{ $t('characters.talentRaised') }}</span></span
        >
        <span
          class="text-xl font-semibold"
          :class="t.crowned ? 'text-talent-crown' : t.from ? 'text-talent-boost' : ''"
          >{{ t.level }}</span
        >
        <img
          v-if="t.crowned && crown"
          :src="crown"
          :alt="$t('characters.crowned')"
          class="size-5 shrink-0 self-center sm:size-6"
        />
      </dd>
    </div>
  </dl>
</template>
