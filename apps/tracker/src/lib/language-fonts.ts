/**
 * Web fonts a language needs beyond Outfit (main.css `:lang()` rules name
 * them): loaded from Google Fonts only when that language is shown, once.
 * index.html's first-paint script keeps a copy of the table for the language
 * it sets before the app runs; keep both in step.
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

/** Adds the language's stylesheet link to the page if it needs one and isn't there yet. */
export function ensureLanguageFont(lang: string, doc: Document = document): void {
  const url = languageFontUrl(lang)
  if (!url || doc.querySelector(`link[data-language-font="${lang}"]`)) return
  const link = doc.createElement('link')
  link.rel = 'stylesheet'
  link.href = url
  link.dataset.languageFont = lang
  doc.head.appendChild(link)
}
