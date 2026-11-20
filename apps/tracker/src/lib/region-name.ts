import { locale } from '@/i18n/locale'

/**
 * A country's name in the language on screen, from its ISO code as
 * Cloudflare reports it ("TH" -> "Thailand"). Codes the browser does not
 * know (Cloudflare's "T1" for Tor, "XX" for unknown) are shown as they are.
 */
export function regionName(code: string): string {
  try {
    return new Intl.DisplayNames([locale.value], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}
