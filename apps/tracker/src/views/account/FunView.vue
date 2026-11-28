<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft } from 'lucide-vue-next'
import FunCard from '@/components/fun/FunCard.vue'
import { provideFunHost } from '@/components/fun/host'
import { FUN_PAGES, funPage, isNewPage } from '@/components/fun/pages'
import PageHeader from '@/components/ui/PageHeader.vue'
import UiIconButton from '@/components/ui/UiIconButton.vue'
import { t } from '@/i18n'
import { useAccount, useAccountRoute } from './context'

/**
 * Fun (docs/plans/fun.md): a bare `/fun` is the hub, a card per sub-page;
 * `/fun/<slug>` is that page, under the same back arrow and title row as a
 * Collections tab. A slug nothing has (an old link) shows the hub.
 */
const route = useRoute()
const account = useAccount()
const accountRoute = useAccountRoute()

const page = computed(() => funPage(route.params.page))
const title = computed(() =>
  page.value ? t(`fun.pages.${page.value.label}.title`) : t('fun.title'),
)
const to = (slug?: string) => ({
  name: accountRoute('account-fun'),
  params: { accountId: account.value.id, ...(slug ? { page: slug } : {}) },
})
const now = Date.now()

// The pages read the account only through this (components/fun/host.ts), so
// the public pages (views/FunPublicView.vue) show the same components.
provideFunHost(
  computed(() => ({
    accountId: account.value.id,
    roster: true,
    teamKey: `fun:randomizer:${account.value.id}`,
    hub: to(),
    page: to,
  })),
)
</script>

<template>
  <div>
    <PageHeader :title="title" />

    <template v-if="page">
      <div class="mb-4 flex min-w-0 items-center gap-x-3">
        <UiIconButton :label="$t('fun.title')" :to="to()">
          <ArrowLeft class="size-5" aria-hidden="true" />
        </UiIconButton>
        <h2 class="min-w-0 flex-1 truncate text-lg font-semibold">{{ title }}</h2>
      </div>
      <!-- Per account too: a page keeps its own state (a roll, what was set). -->
      <component :is="page.component" :key="`${page.slug}:${account.id}`" />
    </template>

    <div
      v-else
      class="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] sm:gap-3"
    >
      <FunCard
        v-for="entry in FUN_PAGES"
        :key="entry.slug"
        :to="to(entry.slug)"
        :title="$t(`fun.pages.${entry.label}.title`)"
        :pitch="$t(`fun.pages.${entry.label}.pitch`)"
        :icon="entry.icon"
        :is-new="isNewPage(entry, now)"
      />
    </div>
  </div>
</template>
