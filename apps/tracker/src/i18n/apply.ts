import { readStorage, writeStorage } from '@/lib/storage'
import { quietTransition } from '@/lib/view-transition'
import { ensureLanguageFont } from '@/lib/language-fonts'
import { i18n, setLocale } from './index'
import {
  browserLanguages,
  detectLocale,
  isLocale,
  type Locale,
  type LocalePreference,
} from './locale'

/**
 * Choosing and showing the language in the browser (the DOM side of
 * i18n/index.ts): the device's saved pick, the browser's languages, the
 * <html lang>.
 */

/** The preference saved on this device (`gdt:lang`), `system` when none. */
export function storedPreference(): LocalePreference {
  const stored = readStorage('lang')
  return isLocale(stored) ? stored : 'system'
}

/** The language a preference shows. */
export function resolveLocale(preference: LocalePreference): Locale {
  return preference === 'system' ? detectLocale(browserLanguages(navigator)) : preference
}

/** The preference on screen: `system` follows the browser when its languages change. */
let shown: LocalePreference | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('languagechange', () => {
    if (shown === 'system') void applyLocale('system', { animate: true })
  })
}

/**
 * Shows a preference's language (i18n/index.ts setLocale), crossfading where
 * View Transitions exist when `animate`, and sets <html lang> (the font stack
 * follows it). `persist` saves the choice on this device (`gdt:lang`;
 * removed for `system`).
 */
export async function applyLocale(
  preference: LocalePreference,
  { persist = false, animate = false } = {},
): Promise<void> {
  if (persist) writeStorage('lang', preference === 'system' ? null : preference)
  shown = preference
  const target = resolveLocale(preference)
  ensureLanguageFont(target)
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  await setLocale(target, (show) => {
    const paint = () => {
      show()
      document.documentElement.lang = target
    }
    if (animate && !reduced && 'startViewTransition' in document) {
      quietTransition(paint)
    } else {
      paint()
    }
  })
  document.documentElement.lang = target
}

/** Development only: a key with no English message warns in the console. */
export function warnMissingKeys(): void {
  i18n.global.missingWarn = import.meta.env.DEV
}
