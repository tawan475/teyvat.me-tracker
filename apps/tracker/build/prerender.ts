/// <reference lib="dom" />
// (DOM types: the page.evaluate callbacks run in the page.)
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'
import { canonicalUrl, INDEXED_PAGES, sitemapXml } from '../src/router/public-pages.ts'
import { injectPrerender, type RenderedPage } from './prerender-html.ts'

/**
 * Search engines and AI crawlers (docs/plans/open-site.md §1).
 *
 * `sitemap`: /sitemap.xml from src/router/public-pages.ts, dated by the build.
 *
 * `prerender`: after the client build is written, each indexed page is opened
 * in headless Chrome against the built files (a small local server; /api
 * answers 401, so pages render signed out; requests to other hosts are
 * refused), and its rendered #app, title and description are written into a
 * copy of index.html: `/` → index.html, `/developers` → developers.html (the
 * Worker's assets serve that at /developers). The app replaces that HTML when
 * it mounts (src/main.ts waits for the route first, so nothing blinks);
 * index.html's head script hides it in another language or when index.html is
 * the fallback for another route.
 *
 * Chrome: `CHROME_PATH`, else the usual install paths (GitHub's Ubuntu runners
 * have google-chrome). `PRERENDER=0` skips the step (the pages then work as
 * before, rendered by the app alone).
 */
export function sitemap(): Plugin {
  return {
    name: 'sitemap',
    apply: 'build',
    generateBundle() {
      if (this.environment.name !== 'client') return
      const lastmod = new Date().toISOString().slice(0, 10)
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(lastmod) })
    },
  }
}

export function prerender(): Plugin {
  return {
    name: 'prerender',
    apply: 'build',
    async writeBundle(options) {
      if (this.environment.name !== 'client') return
      if (process.env.PRERENDER === '0') {
        this.warn('PRERENDER=0: the public pages are not prerendered')
        return
      }
      const dir = options.dir ?? this.environment.config.build.outDir
      const pages = await renderPages(resolve(dir))
      for (const line of pages) this.environment.logger.info(line)
    },
  }
}

const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]

function findChrome(): string {
  const found = [process.env.CHROME_PATH, ...CHROME_PATHS].find((path) => path && existsSync(path))
  if (!found) {
    throw new Error(
      'prerender: no Chrome found. Set CHROME_PATH, or PRERENDER=0 to build without prerendering.',
    )
  }
  return found
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
}

/** The built client, as the Worker's assets would serve it (SPA fallback to the original shell). */
function serve(dir: string, shell: string): Promise<Server> {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)
    if (path.startsWith('/api/')) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end('{"error":"unauthorized"}')
      return
    }
    const file = join(dir, path)
    if (file.startsWith(dir + sep) && existsSync(file) && statSync(file).isFile()) {
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      })
      response.end(readFileSync(file))
      return
    }
    response.writeHead(200, { 'content-type': TYPES['.html'] })
    response.end(shell)
  })
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)))
}

async function renderPages(dir: string): Promise<string[]> {
  const shellFile = join(dir, 'index.html')
  const shell = readFileSync(shellFile, 'utf8')
  const server = await serve(dir, shell)
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const { launch } = await import('puppeteer-core')
  const browser = await launch({
    executablePath: findChrome(),
    headless: true,
    // GitHub's Ubuntu runners refuse the sandbox; only our own build is loaded.
    args: ['--no-sandbox', '--lang=en-US', '--mute-audio'],
  })
  const written: { file: string; html: string }[] = []
  const report: string[] = []
  try {
    for (const target of INDEXED_PAGES) {
      const page = await browser.newPage()
      await page.setViewport({ width: 1366, height: 900 })
      await page.setRequestInterception(true)
      page.on('request', (request) => {
        const url = new URL(request.url())
        const local = url.origin === origin && !/\.(mp4|webm)$/.test(url.pathname)
        void (local ? request.continue() : request.abort())
      })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(String(error)))
      await page.goto(origin + target.path, { waitUntil: 'networkidle0', timeout: 60_000 })
      await page.waitForFunction(
        (path: string) =>
          location.pathname === path &&
          (document.getElementById('app')?.childElementCount ?? 0) > 0 &&
          document.querySelector('main h1, h1') !== null,
        { timeout: 30_000 },
        target.path,
      )
      await page.waitForNetworkIdle({ idleTime: 300, timeout: 30_000 })
      if (errors.length) throw new Error(`prerender ${target.path}: ${errors.join('; ')}`)
      const rendered = await page.evaluate(() => {
        const app = document.getElementById('app')!.cloneNode(true) as HTMLElement
        // A video in the HTML would start loading before the app decides to.
        for (const video of app.querySelectorAll('video')) {
          video.removeAttribute('src')
          video.removeAttribute('autoplay')
          video.setAttribute('preload', 'none')
          for (const source of video.querySelectorAll('source')) source.remove()
        }
        // The loaded mark is the app's (lib/image-loading.ts), not the HTML's.
        for (const image of app.querySelectorAll('img[data-loaded]')) {
          image.removeAttribute('data-loaded')
        }
        return {
          html: app.innerHTML,
          title: document.title,
          description:
            document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ?? '',
          styles: [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
            // Vite adds a chunk's sheet by its full address: keep our own, as paths.
            .map((link) => new URL(link.href, location.href))
            .filter((url) => url.origin === location.origin)
            .map((url) => url.pathname),
        }
      })
      await page.close()
      const result: RenderedPage = {
        path: target.path,
        canonical: canonicalUrl(target.path) ?? '',
        ...rendered,
      }
      if (!result.canonical || !result.title || !result.description) {
        throw new Error(`prerender ${target.path}: no title, description or canonical address`)
      }
      written.push({ file: join(dir, target.file), html: injectPrerender(shell, result) })
      report.push(
        `prerendered ${target.path} → ${target.file} (${Math.round(result.html.length / 1024)} KB): ${result.title}`,
      )
    }
  } finally {
    await browser.close()
    await new Promise((done) => server.close(done))
  }
  // Written last: every page renders against the untouched shell.
  for (const { file, html } of written) writeFileSync(file, html)
  return report
}
