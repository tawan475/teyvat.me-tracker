<script setup lang="ts">
import { computed, ref, shallowRef, type Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
// Imported, not global: the build leaves vue-i18n's components uninstalled (__VUE_I18N_FULL_INSTALL__).
import { I18nT } from 'vue-i18n'
import {
  Activity,
  ArrowRight,
  Bell,
  ClipboardList,
  Clock,
  Download,
  HardDrive,
  History,
  Info,
  InfinityIcon,
  KeyRound,
  Lock,
  MessageCircle,
  Monitor,
  Sparkles,
  Trash2,
  User,
} from 'lucide-vue-next'
import LandingFooter from '@/components/landing/LandingFooter.vue'
import LandingNav from '@/components/landing/LandingNav.vue'
import { DOWNLOAD_URL } from '@/components/landing/links'
import AppearanceControls from '@/components/settings/AppearanceControls.vue'
import FilterChip from '@/components/ui/FilterChip.vue'
import UiModal from '@/components/ui/UiModal.vue'
import UiPopover from '@/components/ui/UiPopover.vue'
import {
  GROUP_LABEL,
  groupCount,
  NOTE_TEXT,
  PRIVACY_GROUPS,
  visibleGroups,
  type KeepKind,
  type PrivacyGroup,
  type PrivacyNote,
  type PrivacyRowKey,
} from '@/data/privacy-page'
import { t } from '@/i18n'
import { DISCORD_URL } from '@/lib/links'
import { vStickyHead } from '@/lib/sticky-head'
import { lastAccountId } from '@/stores/accounts'
import '@/components/landing/landing.css'
import '@/components/landing/privacy.css'

/**
 * /privacy (issue 12 item 7, design A): what the site keeps, for how long, who
 * sees it and how to delete it, as one table whose header sticks
 * (v-sticky-head), with filter chips above it that scroll away. Notes under
 * a row's Kept cell are buttons opening a popover (a bottom sheet on phones).
 * Unlike the other public pages it follows the site's theme (meta `themed`).
 * The figures are the code's (data/privacy-page.ts and its test).
 */
const languageOpen = ref(false)

const navLinks = computed(() => [
  { href: '/app', label: t('landing.footer.tracker') },
  { href: DOWNLOAD_URL, label: t('landing.footer.download') },
  { href: '/developers', label: t('landing.footer.developers') },
])

const filter = ref<PrivacyGroup | 'all'>('all')
const chips = computed(() =>
  (['all', ...PRIVACY_GROUPS] as const).map((key) => ({
    key,
    label: key === 'all' ? t('landing.privacyPage.groups.all') : t(GROUP_LABEL[key]),
    count: groupCount(key),
  })),
)
const groups = computed(() => visibleGroups(filter.value))

const ROW_ICON: Record<PrivacyRowKey, Component> = {
  snapshots: History,
  wishes: Sparkles,
  live: Activity,
  planner: ClipboardList,
  account: User,
  devices: Monitor,
  keys: KeyRound,
  alerts: Bell,
  local: HardDrive,
}
const KEEP_ICON: Record<KeepKind, Component> = {
  forever: InfinityIcon,
  auto: Clock,
  local: HardDrive,
}

/** The open note and the button it hangs from. */
const note = shallowRef<{ id: PrivacyNote; anchor: HTMLElement } | null>(null)
function toggleNote(id: PrivacyNote, event: MouseEvent) {
  if (note.value?.id === id) {
    note.value = null
    return
  }
  note.value = { id, anchor: event.currentTarget as HTMLElement }
}

/** Export: the account last opened on this device, else the account list (sign-in first). */
const snapshotsLink = computed<RouteLocationRaw>(() => {
  const id = lastAccountId()
  return id ? { name: 'account-snapshots', params: { accountId: id } } : { name: 'home' }
})
</script>

<template>
  <div>
    <div class="lp pp">
      <img class="pp-art" src="/hero-bg.webp" alt="" data-skeleton="off" />
      <div class="pp-shade" aria-hidden="true" />
      <LandingNav :links="navLinks" translated @language="languageOpen = true" />
      <section class="wrap pp-hero" aria-labelledby="pp-title">
        <div class="pp-ov">{{ $t('landing.privacy.overline') }}</div>
        <h1 id="pp-title" class="pp-h1">{{ $t('landing.privacyPage.title') }}</h1>
        <p class="pp-lead">{{ $t('landing.privacyPage.lead') }}</p>
      </section>

      <main class="wrap pp-main">
        <div
          class="pp-tools scroll-hide scroll-fade-x"
          role="radiogroup"
          :aria-label="$t('landing.privacyPage.show')"
        >
          <FilterChip
            v-for="chip in chips"
            :key="chip.key"
            radio
            :pressed="filter === chip.key"
            :count="chip.count"
            @toggle="filter = chip.key"
            >{{ chip.label }}</FilterChip
          >
        </div>

        <div class="pp-tablebox">
          <div class="pp-scroll">
            <table class="pp-tbl">
              <colgroup>
                <col class="c-data" />
                <col class="c-kept" />
                <col class="c-who" />
                <col class="c-del" />
              </colgroup>
              <thead v-sticky-head>
                <tr>
                  <th class="pin" scope="col">{{ $t('landing.privacyPage.columns.data') }}</th>
                  <th scope="col">{{ $t('landing.privacyPage.columns.kept') }}</th>
                  <th scope="col">{{ $t('landing.privacyPage.columns.who') }}</th>
                  <th scope="col">{{ $t('landing.privacyPage.columns.delete') }}</th>
                </tr>
              </thead>
              <tbody v-for="entry in groups" :key="entry.group">
                <tr class="grp">
                  <th colspan="4" scope="colgroup">
                    <span class="grp-l">{{ $t(GROUP_LABEL[entry.group]) }}</span>
                  </th>
                </tr>
                <tr v-for="row in entry.rows" :key="row.key" class="pp-row">
                  <th class="pin" scope="row">
                    <div class="pp-name">
                      <component :is="ROW_ICON[row.key]" class="ic" aria-hidden="true" />
                      <div>
                        {{ $t(row.name) }}
                        <div class="pp-what">{{ $t(row.what) }}</div>
                      </div>
                    </div>
                  </th>
                  <td>
                    <span class="keep" :class="`keep--${row.keep.kind}`">
                      <component :is="KEEP_ICON[row.keep.kind]" class="ic" aria-hidden="true" />
                      {{ $t(row.keep.label) }}
                    </span>
                    <div v-if="row.note">
                      <button
                        type="button"
                        class="pp-note"
                        aria-haspopup="dialog"
                        :aria-expanded="note?.id === row.note"
                        @click="toggleNote(row.note, $event)"
                      >
                        <Info class="ic s" aria-hidden="true" />
                        {{ $t(NOTE_TEXT[row.note].label) }}
                      </button>
                    </div>
                  </td>
                  <td>{{ $t(row.who) }}</td>
                  <td>
                    <span class="pp-path">
                      <template v-for="(step, i) in row.path" :key="step">
                        <i v-if="i > 0" aria-hidden="true">›</i>{{ $t(step) }}
                      </template>
                    </span>
                    <div v-if="row.or" class="pp-what">
                      {{ row.or.map((key) => $t(key)).join(' ') }}
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="pp-below">
          <section class="pp-box" aria-labelledby="pp-enc">
            <h2 id="pp-enc" class="pp-h3">
              <Lock class="ic" aria-hidden="true" />{{ $t('landing.privacyPage.boxes.encrypted') }}
            </h2>
            <p>{{ $t('landing.privacyPage.boxes.encryptedBody') }}</p>
          </section>
          <section class="pp-box" aria-labelledby="pp-exp">
            <h2 id="pp-exp" class="pp-h3">
              <Download class="ic" aria-hidden="true" />{{ $t('landing.privacyPage.boxes.export') }}
            </h2>
            <i18n-t keypath="landing.privacyPage.boxes.exportBody" tag="p">
              <template #download
                >{{ $t('shell.page.snapshots') }} › {{ $t('snapshots.bar.download') }}</template
              >
              <template #wishes
                >{{ $t('shell.page.wishHistory') }} › {{ $t('wishes.importExport') }}</template
              >
            </i18n-t>
            <div class="pp-act">
              <RouterLink :to="snapshotsLink" class="pp-btn"
                >{{ $t('landing.privacyPage.boxes.openSnapshots')
                }}<ArrowRight class="ic" aria-hidden="true"
              /></RouterLink>
            </div>
          </section>
          <section class="pp-box" aria-labelledby="pp-del">
            <h2 id="pp-del" class="pp-h3">
              <Trash2 class="ic" aria-hidden="true" />{{
                $t('landing.privacyPage.boxes.deleteAll')
              }}
            </h2>
            <i18n-t keypath="landing.privacyPage.boxes.deleteBody" tag="p">
              <template #path
                >{{ $t('shell.page.settings') }} › {{ $t('settings.deleteUser.title') }}</template
              >
            </i18n-t>
            <div class="pp-act">
              <RouterLink :to="{ name: 'settings' }" class="pp-btn"
                >{{ $t('landing.privacyPage.boxes.openSettings')
                }}<ArrowRight class="ic" aria-hidden="true"
              /></RouterLink>
            </div>
          </section>
        </div>

        <p class="pp-contact">
          <MessageCircle class="ic" aria-hidden="true" />{{ $t('landing.privacyPage.contact') }}
          <a :href="DISCORD_URL" target="_blank" rel="noopener noreferrer">{{
            $t('landing.privacyPage.contactLink')
          }}</a>
        </p>
      </main>
      <LandingFooter />
    </div>

    <UiPopover
      :open="note !== null"
      :anchor="note?.anchor ?? null"
      :label="note ? $t(NOTE_TEXT[note.id].title) : ''"
      :focus="false"
      @close="note = null"
    >
      <div
        v-if="note"
        class="flex flex-col gap-2.5 px-4 pt-3.5 pb-5 text-[15px] text-text-secondary"
      >
        <i18n-t v-if="note.id === 'purged'" keypath="landing.privacyPage.notes.purged.body" tag="p">
          <template #days>
            <b class="font-semibold text-text-primary">{{
              $t('landing.privacyPage.notes.purged.days')
            }}</b>
          </template>
          <template #compact>{{ $t('snapshots.compact.title') }}</template>
        </i18n-t>
        <p v-else>{{ $t(NOTE_TEXT[note.id].body) }}</p>
      </div>
    </UiPopover>
    <UiModal
      :open="languageOpen"
      :title="$t('settings.appearance.language')"
      @close="languageOpen = false"
    >
      <AppearanceControls language-only />
    </UiModal>
  </div>
</template>
