/**
 * The pages search engines should read: open signed out, prerendered to static
 * HTML at build (vite.config.ts `prerender`) and listed in /sitemap.xml. Plain
 * data, so the build reads it too; a test checks each is a public route.
 * A new public page (the demo, a guide) is added here.
 */
export interface IndexedPage {
  /** The route's path, as the router has it. */
  path: string
  /** The prerendered file under the client build: `/` is index.html, the rest `<path>.html` (served at the path itself). */
  file: string
  /** Sitemap hints. */
  changefreq: 'daily' | 'weekly' | 'monthly'
  priority: number
}

export const SITE_ORIGIN = 'https://teyvat.me'

export const INDEXED_PAGES: readonly IndexedPage[] = [
  { path: '/', file: 'index.html', changefreq: 'weekly', priority: 1 },
  { path: '/developers', file: 'developers.html', changefreq: 'monthly', priority: 0.6 },
]

/** The page's canonical address, or null for a page crawlers shouldn't index. */
export function canonicalUrl(path: string): string | null {
  const bare = path.length > 1 ? path.replace(/\/+$/, '') : path
  return INDEXED_PAGES.some((page) => page.path === bare) ? SITE_ORIGIN + bare : null
}

/** /sitemap.xml: every indexed page, dated by the build. */
export function sitemapXml(lastmod: string, pages: readonly IndexedPage[] = INDEXED_PAGES): string {
  const urls = pages.map(
    (page) =>
      `  <url>\n    <loc>${SITE_ORIGIN}${page.path}</loc>\n    <lastmod>${lastmod}</lastmod>\n` +
      `    <changefreq>${page.changefreq}</changefreq>\n    <priority>${page.priority.toFixed(1)}</priority>\n  </url>`,
  )
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${urls.join('\n')}\n</urlset>\n`
  )
}
