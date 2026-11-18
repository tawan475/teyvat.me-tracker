import type { App } from 'vue'
import { createI18n, Translation } from 'vue-i18n'
import en from './locales/en'
import { locale, type Locale } from './locale'

export type MessageSchema = typeof en

/**
 * The site's translations (vue-i18n, Composition API). English is built in;
 * the other languages' messages load on demand (messages per area under locales/).
 * Use `$t` in templates and `t` (below) in scripts; never call `t` at a
 * module's top level, where it would run once in whatever language was on
 * then (scripts/i18n-check.mjs flags it). Pure: the tests import it;
 * choosing the language in the browser is i18n/apply.ts.
 */
export const i18n = createI18n<[MessageSchema], Locale, false>({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en } as Record<Locale, MessageSchema>,
  missingWarn: false,
  fallbackWarn: false,
})

/**
 * Puts the translations on the app, with the `<i18n-t>` component. The build
 * turns vue-i18n's own registration off (`__VUE_I18N_FULL_INSTALL__` in
 * vite.config.ts: no `v-t`, `<i18n-n>` or `<i18n-d>`, which nothing uses), and
 * without this an `<i18n-t>` renders as an empty unknown element: only in the
 * built site, since the dev server leaves vue-i18n's default on. main.ts
 * installs through here; a test renders it as the build would.
 */
export function installI18n(app: App): void {
  app.use(i18n)
  // Already there when vue-i18n registered its own (the dev server).
  if (!app.component('I18nT')) app.component('I18nT', Translation)
}

/** Translate a key (with named values, or a count for plurals). Reactive to the language. */
export const t = i18n.global.t
/** Whether a key exists (in `locale`, default the language on screen). */
export const te = i18n.global.te

const loaders: Record<Exclude<Locale, 'en'>, () => Promise<{ default: unknown }>> = {
  'zh-CN': () => import('./locales/zh-CN'),
  'zh-TW': () => import('./locales/zh-TW'),
  ja: () => import('./locales/ja'),
  ko: () => import('./locales/ko'),
  es: () => import('./locales/es'),
  fr: () => import('./locales/fr'),
  ru: () => import('./locales/ru'),
  th: () => import('./locales/th'),
  vi: () => import('./locales/vi'),
  de: () => import('./locales/de'),
  id: () => import('./locales/id'),
  pt: () => import('./locales/pt'),
  it: () => import('./locales/it'),
  tr: () => import('./locales/tr'),
}
const loaded = new Set<Locale>(['en'])

/** Loads a language's messages once. */
export async function loadMessages(target: Locale): Promise<void> {
  if (loaded.has(target)) return
  const module = await loaders[target as Exclude<Locale, 'en'>]()
  i18n.global.setLocaleMessage(target, module.default as MessageSchema)
  loaded.add(target)
}

/**
 * Work a language needs before it shows (its game names) and caches that hold
 * text in the old one: registered by the modules that own them, so this file
 * imports none of them.
 */
const preloaders: ((target: Locale) => Promise<unknown>)[] = []
const changeHooks: ((target: Locale) => void)[] = []
export function onLocaleLoad(load: (target: Locale) => Promise<unknown>): void {
  preloaders.push(load)
}
export function onLocaleChange(hook: (target: Locale) => void): void {
  changeHooks.push(hook)
}

/**
 * Loads a language and shows it: its messages and every registered preload
 * first, so nothing flashes in English or as raw keys, then one switch.
 * `paint` wraps the switch (the browser's crossfade).
 */
export async function setLocale(
  target: Locale,
  paint: (show: () => void) => void = (show) => show(),
): Promise<void> {
  await Promise.all([
    loadMessages(target),
    ...preloaders.map((load) => load(target).catch(() => undefined)),
  ])
  if (target === locale.value && i18n.global.locale.value === target) return
  paint(() => {
    i18n.global.locale.value = target
    locale.value = target
    for (const hook of changeHooks) hook(target)
  })
}
