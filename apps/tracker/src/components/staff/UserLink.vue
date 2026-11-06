<script setup lang="ts">
import { useSession } from '@/stores/session'

/**
 * A user as staff pages show one: name and #id (left out with `noId`, in
 * a table whose ID column has it), linking to their page when the viewer
 * may open it (`users.view`).
 */
defineProps<{
  user: { id: number; username: string }
  size?: 'sm' | 'lg'
  plain?: boolean
  noId?: boolean
}>()
const session = useSession()
</script>

<template>
  <component
    :is="!plain && session.can('users.view') ? 'RouterLink' : 'span'"
    :to="
      !plain && session.can('users.view')
        ? { name: 'staff-user', params: { userId: user.id } }
        : undefined
    "
    class="inline-flex min-w-0 items-center gap-2"
    :class="!plain && session.can('users.view') ? 'hover:text-accent-text' : ''"
  >
    <span
      class="min-w-0 truncate font-medium"
      :class="size === 'lg' ? 'text-2xl font-semibold' : ''"
      >{{ user.username }}</span
    >
    <span v-if="!noId" class="tabular shrink-0 font-mono text-[0.8125rem] text-text-muted"
      >#{{ user.id }}</span
    >
  </component>
</template>
