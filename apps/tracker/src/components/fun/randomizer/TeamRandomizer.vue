<script setup lang="ts">
import { useFunHost } from '../host'
import AccountTeamRandomizer from './AccountTeamRandomizer.vue'
import RandomizerBoard from './RandomizerBoard.vue'

/**
 * The team randomizer (docs/plans/fun.md). Inside an account its pool is the
 * account's roster, with the "My characters" / "All released" switch; on the
 * public page (no account) the pool is every released character and the
 * board shows no switch (it has no roster to switch to).
 */
const host = useFunHost()
const now = Date.now()
</script>

<template>
  <AccountTeamRandomizer v-if="host.roster" />
  <RandomizerBoard v-else :storage-key="host.teamKey" :at="now" />
</template>
