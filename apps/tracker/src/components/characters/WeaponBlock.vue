<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import { Lock } from 'lucide-vue-next'
import GameIcon from '@/components/ui/GameIcon.vue'
import LevelText from '@/components/ui/LevelText.vue'
import { weaponLines } from '@/data/character-build'
import { TARGET_LEVEL, type EquippedWeapon } from '@/data/characters'
import { weaponIcon } from '@/lib/assets'
import { useAccountRoute } from '@/views/account/context'
import GameStars from './GameStars.vue'
import RefinementPips from './RefinementPips.vue'
import { useDetailTip } from './detail-tip'

/**
 * The equipped weapon as the weapon screen shows it: icon, level, refinement,
 * base ATK and the substat (none on 1–2★); what the passive always adds is
 * in the tooltip. The name opens the Weapons page on it. In the character
 * details the rest of the block shows the passive (detail-tip).
 */
const props = defineProps<{ weapon: EquippedWeapon | null; accountId: number }>()
const routeName = useAccountRoute()
const tip = useDetailTip()

const lines = computed(() => (props.weapon ? weaponLines(props.weapon) : null))
const passiveTitle = computed(() =>
  lines.value?.passive.length
    ? t('characters.weapon.passive', {
        stats: lines.value.passive
          .map((s) => `${s.label} +${s.text}`)
          .join(t('characters.setBonus.join')),
      })
    : undefined,
)
</script>

<template>
  <section
    v-if="weapon"
    class="flex items-center gap-3 rounded-xl border border-border-default bg-surface-raised/85 p-2.5 sm:p-3"
    :aria-label="$t('game.weapon')"
    v-bind="tip?.bind({ kind: 'weapon' }) ?? {}"
  >
    <GameIcon
      :src="weaponIcon(weapon.key, weapon.ascension)"
      :name="weapon.name"
      :rarity="weapon.rarity ?? undefined"
      size="lg"
    />
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <RouterLink
        :to="{
          name: routeName('account-weapons'),
          params: { accountId },
          query: { w: weapon.key },
        }"
        class="truncate font-medium hover:text-accent-text"
        :title="weapon.name"
        >{{ weapon.name }}</RouterLink
      >
      <p class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <LevelText :level="weapon.level" :ascension="weapon.ascension" :target="TARGET_LEVEL" />
        <RefinementPips :value="weapon.refinement" />
        <GameStars v-if="weapon.rarity" :rarity="weapon.rarity" />
        <span
          v-if="weapon.lock"
          class="inline-flex text-text-muted"
          :title="$t('characters.weapon.locked')"
        >
          <Lock class="size-3.5" aria-hidden="true" />
          <span class="sr-only">{{ $t('characters.weapon.locked') }}</span>
        </span>
      </p>
      <dl
        v-if="lines"
        class="flex flex-wrap gap-1.5 text-sm"
        :title="tip ? undefined : passiveTitle"
      >
        <div
          v-for="stat in [lines.atk, lines.sub].filter((s) => s !== null)"
          :key="stat.key"
          class="flex items-baseline gap-1 rounded-md bg-surface-overlay/70 px-1.5 py-0.5"
        >
          <dt class="text-text-secondary">{{ stat.label }}</dt>
          <dd class="tabular font-mono font-medium">{{ stat.text }}</dd>
        </div>
      </dl>
    </div>
  </section>
  <p
    v-else
    class="rounded-xl border border-dashed border-border-strong p-3 text-sm text-text-muted"
    :aria-label="$t('game.weapon')"
  >
    {{ $t('characters.gap.noWeapon') }}
  </p>
</template>
