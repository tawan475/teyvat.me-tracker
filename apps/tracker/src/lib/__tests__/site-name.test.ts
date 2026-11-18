/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import manifestFile from '../../../public/manifest.webmanifest?raw'
import { LOCALES } from '../../i18n/locale'
import { hostOf, SITE_HOST, SITE_NAME } from '../site'

/**
 * Where a self-host's name (SITE_NAME) and address (SITE_URL) show, the user's
 * rule (issue 12): the name only in browser tab titles and the sign-in line
 * ("Sign in to <name>"; the Worker's mails are in worker/test/link-origin.test.ts);
 * the landing page, the footer, the wordmark, the sign-up line, the passkey's
 * name and the web manifest keep Teyvat.me. Share cards name SITE_URL's host.
 * With neither set (teyvat.me) everything reads as it did.
 */

type Messages = Record<string, unknown>
const shell = import.meta.glob<Messages>('../../i18n/locales/*/shell.json', {
  import: 'default',
  eager: true,
})
const auth = import.meta.glob<Messages>('../../i18n/locales/*/auth.json', {
  import: 'default',
  eager: true,
})
const byLocale = (files: Record<string, Messages>) =>
  new Map(Object.entries(files).map(([path, messages]) => [path.split('/').at(-2)!, messages]))
const shells = byLocale(shell)
const auths = byLocale(auth)

const sources = import.meta.glob<string>(['/src/**/*.ts', '/src/**/*.vue', '!**/__tests__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Source text without its comments (good enough for these checks). */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The source files whose code names `word`, sorted. */
function readers(word: RegExp): string[] {
  return Object.entries(sources)
    .filter(([, text]) => word.test(code(text)))
    .map(([path]) => path)
    .sort()
}

describe("the site's name", () => {
  it('is Teyvat.me unless a self-host names its own', () => {
    expect(SITE_NAME).toBe('Teyvat.me')
  })

  it('stands in tab titles and the sign-in line, in every language', () => {
    expect([...shells.keys()].sort()).toEqual([...LOCALES].sort())
    expect([...auths.keys()].sort()).toEqual([...LOCALES].sort())
    for (const locale of LOCALES) {
      const named = [
        shells.get(locale)!.documentTitle,
        shells.get(locale)!.accountDocumentTitle,
        auths.get(locale)!.signInSub,
      ]
      for (const text of named) {
        expect(text, locale).toContain('{site}')
        expect(text, locale).not.toContain('Teyvat.me')
      }
    }
  })

  it('leaves the landing title, the wordmark and the sign-up line on Teyvat.me', () => {
    for (const locale of LOCALES) {
      const kept = [
        shells.get(locale)!.landingTitle,
        shells.get(locale)!.site,
        auths.get(locale)!.registerSub,
      ]
      for (const text of kept) {
        expect(text, locale).toContain('Teyvat.me')
        expect(text, locale).not.toContain('{site}')
      }
      expect(shells.get(locale)!.site, locale).toBe('Teyvat.me')
    }
  })

  it('is read by the tab titles and the sign-in page only', () => {
    expect(readers(/\bSITE_NAME\b/)).toEqual([
      '/src/lib/site.ts',
      '/src/router/document-meta.ts',
      '/src/views/LoginView.vue',
    ])
  })

  it('leaves the installed app (the web manifest) on Teyvat.me', () => {
    const manifest = JSON.parse(manifestFile) as { name: string; short_name: string }
    expect(manifest.name).toBe('Teyvat.me')
    expect(manifest.short_name).toBe('Teyvat.me')
  })
})

describe("share cards' credit", () => {
  /** Every card that prints the site: the build card's page and the seven canvas cards. */
  const cards = [
    '/src/components/characters/ShareCard.vue',
    '/src/components/characters/roster-canvas.ts',
    '/src/components/characters/share-card-canvas.ts',
    '/src/components/characters/team-card-canvas.ts',
    '/src/components/collections/arcana-card-canvas.ts',
    '/src/components/endgame/record-card-canvas.ts',
    '/src/components/endgame/stygian-card-canvas.ts',
    '/src/components/wishes/banner-card-canvas.ts',
  ]

  it('is teyvat.me in production, as before', () => {
    expect(SITE_HOST).toBe('teyvat.me')
  })

  it("is SITE_URL's host on a self-host", () => {
    expect(hostOf('https://teyvat.me')).toBe('teyvat.me')
    expect(hostOf('https://tracker.example')).toBe('tracker.example')
    expect(hostOf('http://localhost:8787')).toBe('localhost:8787')
  })

  it('comes from SITE_HOST on every card, never from a written host', () => {
    expect(readers(/\bSITE_HOST\b/)).toEqual(['/src/lib/site.ts', ...cards].sort())
    // A host drawn as text: 'teyvat.me' as a string of its own in a component.
    const written = Object.entries(sources)
      .filter(
        ([path, text]) =>
          path.startsWith('/src/components/') && /(['"`])teyvat\.me\1/.test(code(text)),
      )
      .map(([path]) => path)
    expect(written).toEqual([])
  })
})
