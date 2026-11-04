import { shallowRef } from 'vue'
import { onLocaleLoad } from '@/i18n'
import { locale, type Locale } from '@/i18n/locale'

/**
 * Event banner titles in the language on screen. The banner data
 * (wish-banners.json, paimon.moe's) names banners in English; the other
 * languages' titles come from HoYoLAB's official Event Wishes Notice posts
 * (wish-banner-names.json, written by gi-cdn's `scripts/wish-banners.ts
 * --names`): English title → { language → title }. A title no post names in
 * a language (every phase before 2022-10, when the posts were English only)
 * stays English. The file loads with the banner data (use-wish-stats) and
 * before a language switch shows (`onLocaleLoad`), so titles never flash
 * English; the English key is what run links and row keys keep.
 */

type Table = Readonly<Record<string, Readonly<Partial<Record<Locale, string>>>>>

const table = shallowRef<Table | null>(null)
let loading: Promise<void> | null = null

/** Loads the titles once (a small JSON chunk); English needs none. */
export function loadBannerNames(): Promise<void> {
  loading ??= import('./wish-banner-names.json').then(
    (m) => {
      // `$comment` and `$unmatched` are the file's own notes, not titles.
      const entries = Object.entries(m.default as Record<string, unknown>).filter(
        ([key, value]) => !key.startsWith('$') && value && typeof value === 'object',
      )
      table.value = Object.fromEntries(entries) as Table
    },
    (error: unknown) => {
      loading = null
      throw error
    },
  )
  return loading
}

onLocaleLoad((target) => (target === 'en' ? Promise.resolve() : loadBannerNames()))

/**
 * A banner's title in `lang` (default: the language on screen): the post's
 * title there, else the English one it was asked with. Reactive to the
 * language and to the file arriving.
 */
export function bannerTitle(name: string, lang: Locale = locale.value): string {
  if (lang === 'en' || !name) return name
  return table.value?.[name]?.[lang] ?? name
}

/** For tests: use this table instead of the file. */
export function setBannerNamesForTest(names: Table | null): void {
  table.value = names
}
