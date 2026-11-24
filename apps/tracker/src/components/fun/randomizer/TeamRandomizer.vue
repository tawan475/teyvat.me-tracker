<script setup lang="ts">
import { computed } from 'vue'
import NotSharedStrip from '@/components/not-shared/NotSharedStrip.vue'
import UiError from '@/components/ui/UiError.vue'
import UiSkeleton from '@/components/ui/UiSkeleton.vue'
import { loadLatestInventory } from '@/data/account-data'
import { buildRoster } from '@/data/characters'
import { useResource } from '@/data/use-resource'
import { pageNow, useAccount, useTravel } from '@/views/account/context'
import RandomizerBoard from './RandomizerBoard.vue'

/** The team randomizer in an account's Fun section: its pool is that account's roster. */
const account = useAccount()
const travel = useTravel()
const inventory = useResource(
  () => account.value,
  (a) => loadLatestInventory(a),
)
const owned = computed(() =>
  inventory.data.value
    ? buildRoster(inventory.data.value.good).characters.map((c) => ({
        key: c.key,
        level: c.level,
        constellation: c.constellation,
      }))
    : [],
)
const at = computed(() => pageNow(travel.value))
</script>

<template>
  <UiError
    v-if="inventory.error.value && inventory.data.value === undefined"
    :title="$t('fun.randomizer.loadFailed')"
    :error="inventory.error.value"
    @retry="inventory.reload()"
  />
  <UiSkeleton v-else-if="inventory.data.value === undefined" class="h-96 w-full" aria-busy="true" />
  <div v-else>
    <NotSharedStrip :sections="['characters']" />
    <RandomizerBoard :owned="owned" :storage-key="`fun:randomizer:${account.id}`" :at="at" />
  </div>
</template>
