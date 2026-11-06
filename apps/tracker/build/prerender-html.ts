/**
 * Writing a prerendered page (build/prerender.ts): the built index.html with
 * the rendered page put in. Only what the page changed goes in (its #app, its
 * title and description, the stylesheets its chunks added, a canonical link),
 * so the first-paint scripts and everything else in the head stay exactly as
 * built. Pure, so a test can hold it.
 */
export interface RenderedPage {
  /** The route's path ("/", "/developers"). */
  path: string
  /** The canonical address (https://teyvat.me/developers). */
  canonical: string
  /** #app's inner HTML once the page rendered (videos unloaded, see prerender.ts). */
  html: string
  title: string
  description: string
  /** Stylesheet hrefs the page had in its head (the shell's are skipped). */
  styles: readonly string[]
}

const escapeText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttribute = (text: string) => escapeText(text).replace(/"/g, '&quot;')

/** Replaces exactly one match, or throws: a shell that changed shape must fail the build. */
function replaceOnce(html: string, pattern: RegExp, by: string, what: string): string {
  const matches = html.match(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g'))
  if (matches?.length !== 1) {
    throw new Error(`prerender: index.html has ${matches?.length ?? 0} ${what}, expected one`)
  }
  return html.replace(pattern, () => by)
}

export function injectPrerender(shell: string, page: RenderedPage): string {
  let html = shell
  html = replaceOnce(
    html,
    /^<html /m,
    `<html data-prerendered="${escapeAttribute(page.path)}" `,
    '<html> tags',
  )
  html = replaceOnce(
    html,
    /<title>[^<]*<\/title>/,
    `<title>${escapeText(page.title)}</title>`,
    '<title> tags',
  )
  for (const [attribute, key, value] of [
    ['name', 'description', page.description],
    ['property', 'og:title', page.title],
    ['property', 'og:description', page.description],
  ] as const) {
    html = replaceOnce(
      html,
      new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*/?>`),
      `<meta ${attribute}="${key}" content="${escapeAttribute(value)}" />`,
      `${key} meta tags`,
    )
  }
  const styles = [...new Set(page.styles)]
    .filter((href) => !html.includes(`href="${href}"`))
    .map((href) => `<link rel="stylesheet" crossorigin href="${escapeAttribute(href)}">`)
  const head = [`<link rel="canonical" href="${escapeAttribute(page.canonical)}" />`, ...styles]
  html = replaceOnce(html, /<\/head>/, `${head.join('\n    ')}\n  </head>`, '</head> tags')
  html = replaceOnce(
    html,
    /<div id="app"><\/div>/,
    `<div id="app" data-prerendered="${escapeAttribute(page.path)}">${page.html}</div>`,
    'empty #app elements',
  )
  return html
}
