import { describe, expect, it } from 'vitest'
import { injectPrerender } from '../../../build/prerender-html'
import shellFile from '../../../index.html?raw'
import robotsFile from '../../../public/robots.txt?raw'
import llms from '../../../public/llms.txt?raw'
import shellMessages from '../../i18n/locales/en/shell.json'
import router from '../index.ts?raw'
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
