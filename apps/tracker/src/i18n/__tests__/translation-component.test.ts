/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from 'vitest'
import { createSSRApp, h, resolveComponent, type App, type Component } from 'vue'
import { createI18n } from 'vue-i18n'
import { renderToString } from 'vue/server-renderer'
import { installI18n, t } from '../index'

/**
 * `<i18n-t>` in the built site. The build defines `__VUE_I18N_FULL_INSTALL__`
 * as false (vite.config.ts), so vue-i18n registers none of its components
 * there and `installI18n` registers `<i18n-t>` itself. Before it did, the tag
 * rendered as an empty unknown element in production only (the iOS install
 * steps in Settings, the staff's delete-user dialog, an artifact's roll count).
 * These tests install the translations the way the build does.
 */

const flags = globalThis as { __VUE_I18N_FULL_INSTALL__?: boolean }
const before = flags.__VUE_I18N_FULL_INSTALL__

/** vue-i18n reads the flag when it is installed on an app. */
function asInTheBuild<T>(install: () => T): T {
  flags.__VUE_I18N_FULL_INSTALL__ = false
  try {
    return install()
  } finally {
    flags.__VUE_I18N_FULL_INSTALL__ = before
  }
}

afterEach(() => {
  flags.__VUE_I18N_FULL_INSTALL__ = before
})

/** What a compiled template does with `<i18n-t keypath="…"><template #name>…`. */
function page(keypath: string, slots: Record<string, () => unknown>): Component {
  return {
    render: () => h('p', [h(resolveComponent('i18n-t') as Component, { keypath }, slots)]),
  }
}

function text(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function built(root: Component): App {
  const app = createSSRApp(root)
  asInTheBuild(() => installI18n(app))
  return app
}

describe('<i18n-t> in a production build', () => {
  it('is not registered by vue-i18n itself there', () => {
    // The premise of this file: should vue-i18n stop reading the flag this
    // way, the tests below would pass without proving anything.
    const app = createSSRApp({ render: () => null })
    asInTheBuild(() => app.use(createI18n({ legacy: false, locale: 'en', messages: { en: {} } })))
    expect(app.component('I18nT')).toBeUndefined()
    expect(app.component('i18n-t')).toBeUndefined()
  })

  it('is registered by installI18n', () => {
    const app = built({ render: () => null })
    expect(app.component('I18nT')).toBeDefined()
  })

  it("renders the delete-user dialog's line with its slot", async () => {
    const app = built(
      page('staff.deleteUser.type', { name: () => h('span', { class: 'font-code' }, 'player01') }),
    )
    const html = await renderToString(app)
    expect(html).not.toContain('<i18n-t')
    expect(html).toContain('<span class="font-code">player01</span>')
    expect(text(html)).toBe(t('staff.deleteUser.type', { name: 'player01' }))
    expect(text(html)).toBe('Type player01 to delete')
  })

  it('renders the iOS install steps', async () => {
    const share = await renderToString(
      built(
        page('settings.app.iosShare', {
          icon: () => h('svg'),
          share: () => h('span', t('settings.app.iosShareLabel')),
        }),
      ),
    )
    expect(text(share)).toBe('Tap  Share.')
    const add = await renderToString(
      built(
        page('settings.app.iosAdd', {
          icon: () => h('svg'),
          add: () => h('span', t('settings.app.iosAddLabel')),
        }),
      ),
    )
    expect(text(add)).toBe('then  Add to Home Screen.')
  })

  it("renders an artifact's roll count, plural and all", async () => {
    const rolls = (count: number) =>
      renderToString(
        built({
          render: () =>
            h(
              resolveComponent('i18n-t') as Component,
              { keypath: 'characters.piece.rolls', tag: 'span', plural: count },
              { n: () => h('span', String(count)) },
            ),
        }),
      )
    expect(text(await rolls(1))).toBe(t('characters.piece.rolls', { n: 1 }, 1))
    expect(text(await rolls(7))).toBe(t('characters.piece.rolls', { n: 7 }, 7))
    expect(text(await rolls(7))).toContain('7')
  })

  it('keeps working where vue-i18n registered it first (the dev server)', async () => {
    const app = createSSRApp(page('staff.deleteUser.type', { name: () => 'player01' }))
    flags.__VUE_I18N_FULL_INSTALL__ = true
    installI18n(app)
    expect(text(await renderToString(app))).toBe('Type player01 to delete')
  })
})

const sources = import.meta.glob<string>(['/src/**/*.ts', '/src/**/*.vue', '!**/__tests__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** Source text without its comments (good enough for these checks). */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The source files whose code matches `word`, sorted. */
function users(word: RegExp): string[] {
  return Object.entries(sources)
    .filter(([, source]) => word.test(code(source)))
    .map(([path]) => path)
    .sort()
}

describe("the app's use of vue-i18n's components", () => {
  it('has pages that use <i18n-t> (or this file checks nothing)', () => {
    expect(users(/<i18n-t[\s>]|<I18nT[\s>]/)).toContain(
      '/src/components/staff/DeleteUserDialog.vue',
    )
    expect(users(/<i18n-t[\s>]|<I18nT[\s>]/)).toContain('/src/components/settings/AppPanel.vue')
    expect(users(/<i18n-t[\s>]|<I18nT[\s>]/)).toContain(
      '/src/components/characters/ArtifactPiece.vue',
    )
  })

  it('installs the translations only through installI18n', () => {
    expect(code(sources['/src/main.ts']!)).toContain('installI18n(app)')
    // A bare `app.use(i18n)` would leave <i18n-t> empty in the built site.
    expect(users(/\.use\(\s*i18n\s*\)/)).toEqual(['/src/i18n/index.ts'])
    expect(users(/\binstallI18n\(/)).toEqual(['/src/i18n/index.ts', '/src/main.ts'])
  })

  it('uses nothing else the build leaves unregistered', () => {
    // installI18n registers <i18n-t> alone: these would render empty (or, for
    // the directive, fail to resolve) in a production build. Register them
    // there first.
    expect(users(/<i18n-n[\s>]|<I18nN[\s>]|<i18n-d[\s>]|<I18nD[\s>]/)).toEqual([])
    expect(users(/\sv-t(\.[a-z]+)*=/)).toEqual([])
  })
})
