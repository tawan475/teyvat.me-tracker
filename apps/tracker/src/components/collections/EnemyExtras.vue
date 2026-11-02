<script setup lang="ts">
/**
 * An enemy's special names and its variants at the dialog's level
 * (EnemyDialog): under the archive text when it has none, else on the
 * stats side. The variant being shown is marked.
 */
defineProps<{
  special: readonly string[]
  variants: readonly { id: number; hp: string; atk: string; def: string }[]
  /** The monster the stats are of (its variant row is marked). */
  shown: number | null
  level: number
}>()
</script>

<template>
  <div v-if="special.length" class="flex flex-col gap-2">
    <h4 class="text-sm font-semibold text-text-muted">
      {{ $t('collections.enemies.specialNames') }}
    </h4>
    <div class="flex flex-wrap gap-1.5">
      <span
        v-for="s in special"
        :key="s"
        class="rounded-full border border-border-default px-2.5 py-0.5 text-xs text-text-secondary"
        >{{ s }}</span
      >
    </div>
  </div>
  <div v-if="variants.length" class="flex flex-col gap-2">
    <h4 class="text-sm font-semibold text-text-muted">
      {{ $t('collections.enemies.variants') }}
      <span class="font-normal">· {{ $t('endgame.level', { n: level }) }}</span>
    </h4>
    <div class="overflow-x-auto rounded-lg border border-border-default">
      <table class="tabular w-full min-w-[18rem] font-mono text-sm">
        <thead class="font-sans text-xs text-text-muted">
          <tr>
            <th class="px-3 py-1.5 text-left font-medium">ID</th>
            <th class="px-3 py-1.5 text-right font-medium">{{ $t('collections.enemies.hp') }}</th>
            <th class="px-3 py-1.5 text-right font-medium">{{ $t('collections.enemies.atk') }}</th>
            <th class="px-3 py-1.5 text-right font-medium">{{ $t('collections.enemies.def') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="v in variants"
            :key="v.id"
            class="border-t border-border-default"
            :class="v.id === shown && 'bg-accent/10 font-semibold'"
            :aria-current="v.id === shown || undefined"
          >
            <td class="px-3 py-1.5 text-text-secondary">
              {{ v.id
              }}<span v-if="v.id === shown" class="text-accent-text" aria-hidden="true"> ●</span>
            </td>
            <td class="px-3 py-1.5 text-right">{{ v.hp }}</td>
            <td class="px-3 py-1.5 text-right">{{ v.atk }}</td>
            <td class="px-3 py-1.5 text-right">{{ v.def }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
