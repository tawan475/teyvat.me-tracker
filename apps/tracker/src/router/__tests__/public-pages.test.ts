import { describe, expect, it } from 'vitest'
import { injectPrerender } from '../../../build/prerender-html'
import {
  buildSiteName,
  buildSiteOrigin,
  PRODUCTION_NAME,
  PRODUCTION_ORIGIN,
  robotsFor,
} from '../../../build/site-origin'
import { SITE_HOST, SITE_NAME } from '../../lib/site'
import shellFile from '../../../index.html?raw'
import robotsFile from '../../../public/robots.txt?raw'
import llms from '../../../public/llms.txt?raw'
import shellMessages from '../../i18n/locales/en/shell.json'
import router from '../index.ts?raw'
// As text: the registry imports the pages' components, which this test's project has no DOM types for.
import funPagesSource from '../../components/fun/pages.ts?raw'
import { canonicalUrl, INDEXED_PAGES, SITE_ORIGIN, sitemapXml } from '../public-pages'

// The repository keeps these files with CRLF line endings (Windows checkouts,
// committed as they are); the checks below are about content, so read them as LF.
const shell = shellFile.replace(/\r\n/g, '\n')
const robots = robotsFile.replace(/\r\n/g, '\n')

/** The route object in router/index.ts whose path is `path` (its source text). */
function routeSource(path: string): string {
  const start = router.indexOf(`path: '${path}',`)
  expect(start, `route ${path}`).toBeGreaterThan(0)
  return router.slice(start, router.indexOf('\n    },', start))
}

describe('indexed pages', () => {
  it('are public routes anyone can open', () => {
    for (const page of INDEXED_PAGES) {
      const source = routeSource(page.path)
      expect(source).toContain('public: true')
      expect(source).not.toMatch(/auth: true|guest: true|beforeEnter/)
    }
  })

  it('are written as files the assets serve at their path', () => {
    for (const page of INDEXED_PAGES) {
      expect(page.file).toBe(page.path === '/' ? 'index.html' : `${page.path.slice(1)}.html`)
    }
  })

  it('have a canonical address, and nothing else does', () => {
    expect(canonicalUrl('/')).toBe(`${SITE_ORIGIN}/`)
    expect(canonicalUrl('/developers/')).toBe(`${SITE_ORIGIN}/developers`)
    expect(canonicalUrl('/app')).toBeNull()
    expect(canonicalUrl('/login')).toBeNull()
  })

  it('make the sitemap', () => {
    const xml = sitemapXml('2026-11-06')
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset')).toBe(true)
    for (const page of INDEXED_PAGES) {
      expect(xml).toContain(`<loc>${SITE_ORIGIN}${page.path}</loc>`)
    }
    expect(xml.match(/<url>/g)).toHaveLength(INDEXED_PAGES.length)
    expect(xml).toContain('<lastmod>2026-11-06</lastmod>')
  })

  it('are in llms.txt', () => {
    for (const page of INDEXED_PAGES) expect(llms).toContain(`(${SITE_ORIGIN}${page.path})`)
  })
})

describe('the public Fun pages', () => {
  const slugs = [...funPagesSource.matchAll(/^    slug: '([a-z-]+)',$/gm)].map((m) => m[1]!)

  it('give every Fun page a public route of its own, with its own title, indexed', () => {
    const hub = routeSource('/fun')
    expect(hub).toContain("component: () => import('@/views/FunPublicView.vue')")
    const titles = new Set<string>()
    expect(slugs.length).toBeGreaterThan(3)
    for (const slug of slugs) {
      const path = `/fun/${slug}`
      const source = routeSource(path)
      expect(source).toContain("component: () => import('@/views/FunPublicView.vue')")
      expect(source).toContain('public: true')
      const title = /title: '([A-Za-z]+)'/.exec(source)?.[1]
      expect(title, path).toBeDefined()
      expect(Object.keys(shellMessages.page)).toContain(title)
      titles.add(title!)
      expect(INDEXED_PAGES.some((p) => p.path === path)).toBe(true)
    }
    expect(titles.size).toBe(slugs.length)
    expect(INDEXED_PAGES.some((p) => p.path === '/fun')).toBe(true)
  })

  it('send the old randomizer address to the public one', () => {
    expect(router).toContain("{ path: '/randomizer', redirect: '/fun/team-randomizer' }")
  })
})

describe('robots.txt', () => {
  const groups = robots.split(/\n\s*\n/).filter((group) => /^User-agent:/m.test(group))

  it('keeps every crawler out of the app, the API and the sign-in hand-offs', () => {
    expect(groups.length).toBe(2)
    for (const group of groups) {
      for (const path of ['/app/', '/api/', '/link', '/oauth']) {
        expect(group).toContain(`Disallow: ${path}\n`)
      }
      expect(group).toContain('Allow: /\n')
    }
  })

  it('names the AI crawlers and the sitemap', () => {
    for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
      expect(robots).toContain(`User-agent: ${bot}\n`)
    }
    expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`)
  })

  it('never disallows an indexed page', () => {
    const disallowed = [...robots.matchAll(/^Disallow: (\S+)/gm)].map((m) => m[1]!)
    for (const page of INDEXED_PAGES.filter((p) => p.path !== '/')) {
      expect(disallowed.some((path) => page.path.startsWith(path))).toBe(false)
    }
  })
})

describe('page descriptions', () => {
  it('cover every page title, and the landing page', () => {
    const descriptions = Object.keys(shellMessages.description).sort()
    expect(descriptions).toEqual([...Object.keys(shellMessages.page), 'landing'].sort())
  })
})

describe('index.html', () => {
  it('describes the site and the app as two things (JSON-LD)', () => {
    const block = shell.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    const data = JSON.parse(block![1]!) as { '@graph': { '@type': string; name: string }[] }
    const types = data['@graph'].map((node) => `${node['@type']}:${node.name}`)
    expect(types).toContain('WebSite:Teyvat.me')
    expect(types).toContain('SoftwareApplication:Teyvat.me Capture')
  })
})

describe('injectPrerender', () => {
  const page = {
    path: '/developers',
    canonical: `${SITE_ORIGIN}/developers`,
    html: '<div class="lp"><h1>Leyline &amp; more</h1></div>',
    title: 'Leyline · Teyvat.me',
    description: 'The "Leyline" format & API.',
    styles: ['/assets/DevelopersView-abc.css', '/assets/DevelopersView-abc.css'],
  }
  const html = injectPrerender(shell, page)

  it('fills #app and marks the page', () => {
    expect(html).toContain(`<div id="app" data-prerendered="/developers">${page.html}</div>`)
    expect(html).toMatch(/^<!doctype html>\n<html data-prerendered="\/developers" lang="en"/)
  })

  it('sets the title, description, preview tags and canonical link', () => {
    expect(html).toContain('<title>Leyline · Teyvat.me</title>')
    expect(html).toContain(
      '<meta name="description" content="The &quot;Leyline&quot; format &amp; API." />',
    )
    expect(html).toContain('<meta property="og:title" content="Leyline · Teyvat.me" />')
    expect(html).toContain('<meta property="og:description" content="The &quot;Leyline')
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/developers" />`)
    expect(html.match(/DevelopersView-abc\.css/g)).toHaveLength(1)
  })

  it('keeps the first-paint scripts as they are', () => {
    for (const script of shell.match(/<script>[\s\S]*?<\/script>/g)!) {
      expect(html).toContain(script)
    }
    expect(html).toMatch(/\n {10}var ours = \[.*\]\n/)
  })

  it('refuses a shell it cannot place the page in', () => {
    expect(() => injectPrerender(shell.replace('<div id="app"></div>', ''), page)).toThrow(/#app/)
    expect(() => injectPrerender(html, page)).toThrow()
  })
})

describe("a self-host's origin (SITE_URL at build)", () => {
  it('is teyvat.me without SITE_URL, else its origin; a bad one stops the build', () => {
    expect(SITE_ORIGIN).toBe(PRODUCTION_ORIGIN)
    expect(buildSiteOrigin(undefined)).toBe('https://teyvat.me')
    expect(buildSiteOrigin('')).toBe('https://teyvat.me')
    expect(buildSiteOrigin('https://tracker.example/path/')).toBe('https://tracker.example')
    expect(buildSiteOrigin('http://localhost:8787')).toBe('http://localhost:8787')
    expect(() => buildSiteOrigin('tracker.example')).toThrow(/not a URL/)
    expect(() => buildSiteOrigin('ftp://tracker.example')).toThrow(/http/)
  })

  it('puts canonical links, the sitemap and robots.txt on it', () => {
    const origin = 'https://tracker.example'
    expect(canonicalUrl('/developers', origin)).toBe(`${origin}/developers`)
    const xml = sitemapXml('2026-11-18', INDEXED_PAGES, origin)
    expect(xml).not.toContain('teyvat.me')
    for (const page of INDEXED_PAGES) expect(xml).toContain(`<loc>${origin}${page.path}</loc>`)
    const own = robotsFor(robots, origin)
    expect(own).toContain(`Sitemap: ${origin}/sitemap.xml`)
    expect(own).not.toContain('Sitemap: https://teyvat.me')
    // teyvat.me's own files are untouched.
    expect(robotsFor(robots, PRODUCTION_ORIGIN)).toBe(robots)
    expect(sitemapXml('2026-11-18')).toBe(
      sitemapXml('2026-11-18', INDEXED_PAGES, PRODUCTION_ORIGIN),
    )
  })
})

describe("a self-host's name (SITE_NAME at build)", () => {
  it('is Teyvat.me without SITE_NAME, else the name given', () => {
    expect(SITE_NAME).toBe(PRODUCTION_NAME)
    expect(PRODUCTION_NAME).toBe('Teyvat.me')
    expect(buildSiteName(undefined)).toBe('Teyvat.me')
    expect(buildSiteName('  ')).toBe('Teyvat.me')
    expect(buildSiteName(' Our Tracker ')).toBe('Our Tracker')
  })

  it('leaves share cards on teyvat.me in production', () => {
    expect(SITE_HOST).toBe('teyvat.me')
  })

  it("puts it in every language's tab titles, not in the landing title", () => {
    expect(shellMessages.documentTitle).toBe('{title} · {site}')
    expect(shellMessages.accountDocumentTitle).toBe('{title} · {account} · {site}')
    expect(shellMessages.landingTitle).toContain('Teyvat.me')
  })
})
