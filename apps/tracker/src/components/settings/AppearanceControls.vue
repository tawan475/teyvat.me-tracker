<script setup lang="ts">
import type { UserSettings } from '@gdt/shared'
import { TAB_BAR_MAX, TAB_BAR_MIN, tabBarPages } from '@gdt/shared/settings'
import { computed, ref } from 'vue'
import { MoreHorizontal } from 'lucide-vue-next'
import { ACCOUNT_SECTIONS } from '@/components/shell/nav'
import UiSegmented from '@/components/ui/UiSegmented.vue'
import UiSortableLists, {
  type SortableItem,
  type SortableTexts,
} from '@/components/ui/UiSortableLists.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import UiSwitch from '@/components/ui/UiSwitch.vue'
import { t } from '@/i18n'
import { applyLocale, storedPreference } from '@/i18n/apply'
import { LANGUAGE_NAMES } from '@/i18n/language-names'
import { LOCALES, type LocalePreference } from '@/i18n/locale'
import { setClockPreference } from '@/lib/format'
import { applyTheme, type ThemePreference } from '@/lib/theme'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'

/**
 * Theme, language and clock, as the Settings card and the top bar's modal
 * show them. `updateSettings` applies the change before the server answers;
 * if the save fails, the previous value is put back here (the store keeps the
 * optimistic value) and a toast says so. The language also applies and is
 * remembered on this device at once (i18n/apply.ts); the account's setting
 * follows it to the user's other devices. Signed out (the public pages, which
 * are always dark) only the language shows, kept on this device.
 */
/**
 * `inline`: Settings › Appearance: theme, language and clock in one row of
 * three, the phone tab bar's two lists under them (the top bar's modal
 * stacks the three and shows the same lists).
 * `languageOnly`: the public pages (always dark): theme and clock would
 * change nothing there (a theme pick only flashed the page), so only the
 * language shows, signed in or not.
 */
const props = defineProps<{ inline?: boolean; languageOnly?: boolean }>()
const session = useSession()
const feedback = useFeedback()

const themes = computed<{ value: ThemePreference; label: string }[]>(() => [
  { value: 'system', label: t('settings.appearance.system') },
  { value: 'light', label: t('settings.appearance.light') },
  { value: 'dark', label: t('settings.appearance.dark') },
])

/** Each language named in itself, whatever the language on screen. */
const languages = computed<{ value: LocalePreference; label: string }[]>(() => [
  { value: 'system', label: t('settings.appearance.system') },
  ...LOCALES.map((code) => ({ value: code, label: LANGUAGE_NAMES[code] })),
])

const theme = computed<ThemePreference>({
  get: () => session.settings.theme,
  set: (value) => void save({ theme: value }, t('settings.appearance.themeNotSaved')),
})
const use24Hour = computed<boolean>({
  get: () => session.settings.use24Hour,
  set: (value) => void save({ use24Hour: value }, t('settings.appearance.clockNotSaved')),
})
/**
 * The phone tab bar (Settings › Appearance and the globe dialog): its pages
 * in the user's order (UiSortableLists: drag, tap, arrow keys), 1 to
 * TAB_BAR_MAX; More lists the rest in the sidebar's order. Each move is
 * saved at once; a failed save puts the old order back.
 */
const tabBar = computed(() => tabBarPages(session.settings.tabBar))
const tabItems = computed<SortableItem[]>(() =>
  ACCOUNT_SECTIONS.map((s) => ({ key: s.label, label: t(`shell.nav.${s.label}`), icon: s.icon })),
)
const tabTexts = computed<SortableTexts>(() => ({
  ordered: t('settings.appearance.tabBar'),
  orderedHint: t('settings.appearance.tabBarHint', { n: TAB_BAR_MAX }),
  other: t('common.more'),
  full: t('settings.appearance.tabBarFull'),
  fullHint: t('settings.appearance.tabBarFullHint'),
  last: t('settings.appearance.tabBarLast'),
  lastHint: t('settings.appearance.tabBarLastHint'),
  dropHere: t('settings.appearance.tabBarDropHere'),
  toOther: t('settings.appearance.tabBarToMore'),
  otherGripTitle: t('settings.appearance.tabBarDragTitle'),
  handleLabel: (name, n) => t('settings.appearance.tabBarHandleLabel', { name, n }),
  handleTitle: (n) => t('settings.appearance.tabBarHandleTitle', { n }),
  toOtherLabel: (name) => t('settings.appearance.tabBarToMoreLabel', { name }),
  toOrderedLabel: (name) => t('settings.appearance.tabBarToBarLabel', { name }),
  badgePlace: (n) => t('settings.appearance.tabBarBadgePlace', { n }),
  badgeSwap: (n) => t('settings.appearance.tabBarBadgeSwap', { n }),
  said: (said, name) =>
    said.kind === 'place'
      ? t('settings.appearance.tabBarSaidPlace', {
          name: name(said.key),
          n: said.n,
          max: TAB_BAR_MAX,
        })
      : said.kind === 'other'
        ? t('settings.appearance.tabBarSaidMore', { name: name(said.key) })
        : t('settings.appearance.tabBarSaidSwap', {
            name: name(said.key),
            n: said.n,
            other: name(said.other),
          }),
}))
function setTabBar(list: string[]) {
  void save({ tabBar: list }, t('settings.appearance.tabBarNotSaved'))
}
const signedIn = computed(() => session.status === 'signed-in')
/** Theme and clock: the app's pages, signed in. */
const full = computed(() => signedIn.value && !props.languageOnly)
/** Signed out: the pick made on this device. */
const localLanguage = ref<LocalePreference>(storedPreference())
const language = computed<LocalePreference>({
  get: () => (signedIn.value ? (session.settings.language ?? 'system') : localLanguage.value),
  set: (value) => {
    void applyLocale(value, { persist: true, animate: true })
    if (signedIn.value) void save({ language: value }, t('settings.appearance.languageNotSaved'))
    else localLanguage.value = value
  },
})

async function save(patch: Partial<UserSettings>, failure: string) {
  const before = { ...session.settings }
  try {
    await session.updateSettings(patch)
  } catch (error) {
    rollback(patch, before)
    feedback.error(failure, error)
  }
}

/** Restores each patched key, unless a later change has already replaced it. */
function rollback(patch: Partial<UserSettings>, before: UserSettings) {
  const me = session.me
  if (!me) return
  const restored = { ...me.settings }
  let changed = false
  if (patch.theme !== undefined && me.settings.theme === patch.theme) {
    restored.theme = before.theme
    applyTheme(before.theme)
    changed = true
  }
  if (patch.use24Hour !== undefined && me.settings.use24Hour === patch.use24Hour) {
    restored.use24Hour = before.use24Hour
    setClockPreference(before.use24Hour)
    changed = true
  }
  if (patch.language !== undefined && me.settings.language === patch.language) {
    restored.language = before.language
    changed = true
  }
  if (patch.tabBar !== undefined && me.settings.tabBar === patch.tabBar) {
    restored.tabBar = before.tabBar
    changed = true
  }
  if (changed) session.me = { ...me, settings: restored }
}
</script>

<template>
  <div v-if="props.inline && full" class="flex flex-col">
    <div class="flex flex-wrap items-end gap-x-6 gap-y-4">
      <div class="flex min-w-0 flex-col items-start gap-2">
        <span class="text-base">{{ $t('settings.appearance.theme') }}</span>
        <UiSegmented v-model="theme" :options="themes" :label="$t('settings.appearance.theme')" />
      </div>
      <div class="flex min-w-0 flex-col items-start gap-2">
        <span class="text-base">{{ $t('settings.appearance.language') }}</span>
        <UiSelect
          v-model="language"
          :options="languages"
          :aria-label="$t('settings.appearance.language')"
          class="w-44"
        />
      </div>
      <div class="flex min-h-10 min-w-0 flex-col justify-center">
        <UiSwitch v-model="use24Hour" :label="$t('settings.appearance.clock24')" />
      </div>
    </div>
    <div class="mt-4 border-t border-border-subtle pt-4">
      <UiSortableLists
        :model-value="tabBar"
        :items="tabItems"
        :max="TAB_BAR_MAX"
        :min="TAB_BAR_MIN"
        :texts="tabTexts"
        :other-icon="MoreHorizontal"
        @change="setTabBar"
      />
    </div>
  </div>
  <div v-else class="flex flex-col divide-y divide-border-subtle">
    <div v-if="full" class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3">
      <span class="text-base">{{ $t('settings.appearance.theme') }}</span>
      <UiSegmented v-model="theme" :options="themes" :label="$t('settings.appearance.theme')" />
    </div>
    <div
      class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
      :class="full ? 'py-3' : 'pb-1'"
    >
      <span class="text-base">{{ $t('settings.appearance.language') }}</span>
      <UiSelect
        v-model="language"
        :options="languages"
        :aria-label="$t('settings.appearance.language')"
        class="w-44"
      />
    </div>
    <div v-if="full" class="py-3">
      <UiSwitch v-model="use24Hour" :label="$t('settings.appearance.clock24')" />
    </div>
    <div v-if="full" class="pt-3">
      <UiSortableLists
        :model-value="tabBar"
        :items="tabItems"
        :max="TAB_BAR_MAX"
        :min="TAB_BAR_MIN"
        :texts="tabTexts"
        :other-icon="MoreHorizontal"
        @change="setTabBar"
      />
    </div>
  </div>
</template>
