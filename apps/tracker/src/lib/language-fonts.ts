/**
 * Web fonts a language needs beyond Outfit (main.css `:lang()` rules name
 * them): loaded from Google Fonts only when that language is shown, once.
 * index.html's first-paint script keeps a copy of the table for the language
 * it sets before the app runs; `first-paint.test.ts` checks both agree.
 *
 * The document is typed by hand: this module is also compiled for the tests
 * (no DOM types there).
 */

/** Google Fonts `family=` query per site language that loads a web font. */
export const LANGUAGE_FONTS: Readonly<Record<string, string>> = {
  th: 'Noto+Sans+Thai:wght@400;500;600;700',
  ru: 'Manrope:wght@400;500;600;700;800',
}

export function languageFontUrl(lang: string): string | null {
  const family = LANGUAGE_FONTS[lang]
  return family ? `https://fonts.googleapis.com/css2?family=${family}&display=swap` : null
}

interface LinkLike {
  rel: string
  href: string
  setAttribute(name: string, value: string): void
}
interface DocumentLike {
  querySelector(selector: string): unknown
  createElement(tag: 'link'): LinkLike
  head: { appendChild(node: LinkLike): unknown }
}
const host = globalThis as { document?: DocumentLike }

/** Adds the language's stylesheet link to the page if it needs one and isn't there yet. */
export function ensureLanguageFont(lang: string, doc = host.document): void {
  const url = languageFontUrl(lang)
  if (!doc || !url || doc.querySelector(`link[data-language-font="${lang}"]`)) return
  const link = doc.createElement('link')
  link.rel = 'stylesheet'
  link.href = url
  link.setAttribute('data-language-font', lang)
  doc.head.appendChild(link)
}
