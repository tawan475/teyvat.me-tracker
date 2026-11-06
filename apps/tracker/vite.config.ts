import { execSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { cloudflare, type PluginConfig } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin, type Rolldown } from 'vite'
import vueDevTools from 'vite-plugin-vue-devtools'

import { GI_CDN_HOST, IMAGE_HOST } from '@gdt/game-data/image-url'
import { prerender, sitemap } from './build/prerender.ts'
import { oauthMock } from './dev/oauth-mock.ts'
import pkg from './package.json' with { type: 'json' }

function git(command: string): string {
  try {
    return execSync(`git ${command}`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

// Baked into the bundle and reported by /api/health.
const build = {
  version: pkg.version,
  commit: git('rev-parse --short HEAD') || 'unknown',
  dirty: git('status --porcelain') !== '',
  builtAt: new Date().toISOString(),
}
const migrations = readdirSync(new URL('./migrations', import.meta.url))
  .filter((name) => name.endsWith('.sql'))
  .sort()

/** Where game images load from, as the game data says (src/lib/assets.ts uses the same). */
const imageHosts = [IMAGE_HOST, GI_CDN_HOST].map((url) => new URL(url).hostname)

/** index.html's preconnect to the image host. */
function imageHostPreconnect(): Plugin {
  return {
    name: 'image-host-preconnect',
    transformIndexHtml: (html) => html.replace('__IMAGE_ORIGIN__', new URL(IMAGE_HOST).origin),
  }
}

/**
 * The app's own modules that load at startup (statically reachable from
 * src/main.ts), except main.ts and the router (whose lazy page imports name
 * every page's file). They go in one `app` chunk instead of the entry chunk:
 * pages import them from there, so a page's new file name changes only the
 * router's chunk, not every page that imports a store or a helper (a one-line
 * change to one page renamed 60 of 184 files).
 */
const startupModules = new Set<string>()
function startupGraph(): Plugin {
  const imports = new Map<string, readonly string[]>()
  return {
    name: 'startup-graph',
    apply: 'build',
    moduleParsed(info) {
      imports.set(info.id, info.importedIds)
    },
    buildEnd() {
      if (this.environment.name !== 'client') return
      startupModules.clear()
      const entry = [...imports.keys()].find((id) => /[\/]src[\/]main\.ts$/.test(id))
      const queue = entry ? [entry] : []
      const seen = new Set(queue)
      while (queue.length) {
        for (const next of imports.get(queue.pop()!) ?? []) {
          if (!seen.has(next)) {
            seen.add(next)
            queue.push(next)
          }
        }
      }
      for (const id of seen) {
        const own = /[\/]apps[\/]tracker[\/]src[\/]/.test(id) && !id.includes('node_modules')
        if (own && !/[\/]src[\/](main\.ts|router[\/]index\.ts)$/.test(id)) startupModules.add(id)
      }
    },
  }
}

/**
 * The files index.html loads: the entry chunk, what it imports statically
 * (recursively) and their CSS. Every other chunk loads when a page asks.
 */
function startupFiles(bundle: Rolldown.OutputBundle): string[] {
  const files = new Set<string>()
  const visit = (name: string) => {
    const chunk = bundle[name]
    if (!chunk || chunk.type !== 'chunk' || files.has(name)) return
    files.add(name)
    for (const css of chunk.viteMetadata?.importedCss ?? []) files.add(css)
    for (const imported of chunk.imports) visit(imported)
  }
  for (const [name, chunk] of Object.entries(bundle)) {
    if (chunk.type === 'chunk' && chunk.isEntry) visit(name)
  }
  return [...files]
}

/**
 * Emits /sw.js from src/pwa/sw-template.js with this build's id, the files
 * to precache (the app shell, its icons and the startup JS/CSS; other chunks
 * are cached when first used) and the image hosts it keeps cache-first.
 */
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      if (this.environment.name !== 'client') return
      const startup = startupFiles(bundle).map((file) => `/${file}`)
      const precache = ['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png', ...startup]
      const source = readFileSync(new URL('./src/pwa/sw-template.js', import.meta.url), 'utf8')
        .replace("'__BUILD__'", JSON.stringify(`${build.commit}-${Date.now().toString(36)}`))
        .replace('__PRECACHE__', JSON.stringify(precache))
        .replace(
          '__BUILT__',
          JSON.stringify(
            Object.keys(bundle)
              .filter((file) => file.startsWith('assets/'))
              .map((file) => `/${file}`),
          ),
        )
        .replace('__IMAGE_HOSTS__', JSON.stringify(imageHosts))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

/**
 * `vite dev` only, so the account flows work locally. Builds never get these:
 * - a simulated `send_email` binding (Miniflare logs each mail and saves its
 *   text and HTML to a file; nothing is sent). The deployed Worker has EMAIL
 *   once wrangler.jsonc does (see there). Like production, the email features
 *   stay paused unless `.dev.vars` has `EMAIL_FEATURES=1`.
 * - OAUTH_DEV_MOCK: "Continue with Discord / Google" go to the fake provider
 *   in dev/oauth-mock.ts. `OAUTH_DEV_MOCK=0` in .dev.vars turns it off.
 * - The human check (worker/lib/turnstile.ts) with Cloudflare's always-pass
 *   test keys: the real widget, invisible, every token accepted. Keys in
 *   .dev.vars override them (site key 3x00000000000000000000FF forces an
 *   interactive challenge); empty ones turn the check off.
 */
const devWorker: PluginConfig = {
  config: (worker) => ({
    ...(worker.send_email?.length ? {} : { send_email: [{ name: 'EMAIL' }] }),
    vars: {
      ...worker.vars,
      OAUTH_DEV_MOCK: '1',
      TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    },
  }),
}

// https://vite.dev/config/
// The Cloudflare plugin runs worker/index.ts in workerd during `vite dev` and
// builds the SPA plus the Worker together for `wrangler deploy`.
export default defineConfig(({ command }) => ({
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
    // `vite dev` only: the fake Discord / Google at /__oauth-mock.
    oauthMock(),
    cloudflare(command === 'serve' ? devWorker : {}),
    imageHostPreconnect(),
    serviceWorker(),
    startupGraph(),
    // Crawlers: /sitemap.xml and the public pages as static HTML (build/prerender.ts).
    sitemap(),
    prerender(),
  ],
  // Pre-bundle every client dependency up front. Discovering one at runtime
  // makes Vite re-optimise and invalidate loaded modules, which shows up as
  // "Failed to fetch dynamically imported module" in an open tab.
  optimizeDeps: {
    include: [
      'vue',
      'vue-router',
      'pinia',
      'lucide-vue-next',
      'zod',
      'fflate',
      'chart.js',
      'chartjs-plugin-zoom',
      'vue-chartjs',
      '@vueuse/core',
      'vue-i18n',
    ],
    // The game data (a git dependency, built ESM) is served as is: pre-bundling
    // would merge its per-file JSON chunks, and its subpath modules would each
    // need an entry here.
    exclude: ['@gdt/game-data'],
  },
  environments: {
    client: {
      build: {
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                // The framework (Vue, the router, Pinia, vue-i18n): every page needs
                // it at startup, and it changes only with a dependency update.
                {
                  name: 'vendor',
                  test: /[\/]node_modules[\/](vue|@vue[\/][^\/]+|vue-router|pinia|vue-i18n|@intlify[\/][^\/]+)[\/]/,
                  priority: 20,
                },
                // Every lucide icon in one chunk (~100 icons): one request instead
                // of a file per icon (the shell alone used ~15).
                { name: 'icons', test: /[\/]lucide-vue-next[\/]/, priority: 10 },
                // The app's startup modules (startupGraph): out of the entry chunk.
                // Not the styles: the one Tailwind sheet changes with any new class,
                // and a chunk's name follows its CSS; with the entry it renames
                // the entry alone.
                {
                  name: 'app',
                  test: (id: string) => startupModules.has(id) && !/\.css$|[?&]type=style/.test(id),
                  priority: 5,
                },
              ],
            },
          },
        },
      },
    },
  },
  // JSON imports are used whole; per-key named exports doubled the icon map's size.
  json: { namedExports: false },
  define: {
    // vue-i18n: Composition API only, no devtools hooks in production.
    __VUE_I18N_LEGACY_API__: false,
    __VUE_I18N_FULL_INSTALL__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
    __BUILD__: JSON.stringify(build),
    __MIGRATIONS__: JSON.stringify(migrations),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
}))
