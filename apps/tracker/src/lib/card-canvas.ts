/**
 * Share cards drawn straight onto a canvas (the character card, the artifact
 * card): the pieces they share. Rasterising the DOM card with
 * modern-screenshot (clone with computed styles, inline every image as a
 * data URL, an SVG picture drawn twice 150 ms apart) took about a second
 * and blocked the page for a few hundred ms; a canvas draws the same
 * picture in a few frames. The cards' DOM versions stay what the page shows
 * (with their tooltips); these draw what the PNG is, from the same numbers.
 *
 * What the DOM gave for free is redone here in its terms: CSS line boxes
 * (the baseline inside a `line-height`), `text-overflow: ellipsis`, Outfit's
 * tabular figures (a FontFace with `tnum` on, as canvas text has no
 * font-variant-numeric), box and text shadows, inset rings and backdrop
 * blur. Shadows and filters work in device pixels, so the `Painter` scales
 * them with the drawing.
 */

import type { Shadow } from './css-shadow'
import { fontFiles, parseGoogleFontCss } from './font-embed'
import { Lru } from './lru'

export { parseInsetRing, parseShadows, type Shadow } from './css-shadow'

// ------------------------------------------------------------------ images

/**
 * Fetched pictures by URL, kept across draws (stepping to the next character
 * fetches only what is new): the compressed bytes, decoded per draw and
 * closed after it, so a hundred splashes don't sit decoded in memory. A
 * pending fetch weighs 0, a picture its size; ~24 MB in all.
 */
const fetched = new Lru<string, { blob: Promise<Blob | null>; size: number }>(
  600,
  24_000_000,
  (entry) => entry.size,
)

async function fetchBlob(url: string): Promise<Blob | null> {
  // Once more past the HTTP cache if the first fails: a copy cached from a
  // plain <img> load may lack the CORS header both hosts send.
  for (const cache of ['default', 'reload'] as const) {
    try {
      const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache })
      if (response.ok) return await response.blob()
    } catch {
      // try again past the cache
    }
  }
  return null
}

function imageBlob(url: string): Promise<Blob | null> {
  const cached = fetched.get(url)
  if (cached) return cached.blob
  const blob = fetchBlob(url).then((found) => {
    // A failure isn't kept (the next draw asks again); a picture is weighed now.
    if (!found) fetched.delete(url)
    else if (fetched.get(url)?.blob === blob) fetched.set(url, { blob, size: found.size })
    return found
  })
  fetched.set(url, { blob, size: 0 })
  return blob
}

/** Decoded pictures for one draw, by URL; `close` frees them once drawn. */
export class CardImages {
  private readonly map = new Map<string, ImageBitmap | null>()
  /** Pictures that couldn't be had (drawn without them). */
  missing = 0

  /** Fetches and decodes every URL (blank ones are skipped). */
  static async load(urls: Iterable<string>): Promise<CardImages> {
    const images = new CardImages()
    await Promise.all(
      [...new Set(urls)].filter(Boolean).map(async (url) => {
        const blob = await imageBlob(url)
        const bitmap = blob ? await createImageBitmap(blob).catch(() => null) : null
        if (!bitmap) images.missing++
        images.map.set(url, bitmap)
      }),
    )
    return images
  }

  get(url: string): ImageBitmap | null {
    return url ? (this.map.get(url) ?? null) : null
  }

  close(): void {
    for (const bitmap of this.map.values()) bitmap?.close()
    this.map.clear()
  }
}

// ------------------------------------------------------------------ fonts

/** A copy of Outfit with tabular figures always on (the cards' numbers). */
const TABULAR = 'gdt tabular'
let tabularFaces: Promise<boolean> | null = null

async function fetchText(url: string): Promise<string> {
  for (const cache of ['default', 'reload'] as const) {
    try {
      const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache })
      if (response.ok) return await response.text()
    } catch {
      // try again past the cache
    }
  }
  throw new Error(`fetch failed: ${url}`)
}

/**
 * Registers Outfit's files (from the page's Google Fonts stylesheet) once
 * more as TABULAR with `tnum` on: canvas text has no font-variant-numeric,
 * and the cards set tabular-nums. False when that can't be done (digits then
 * keep Outfit's proportional widths).
 */
function registerTabular(): Promise<boolean> {
  tabularFaces ??= (async () => {
    const link = document.querySelector<HTMLLinkElement>(
      'link[rel="stylesheet"][href*="fonts.googleapis.com"]',
    )
    if (!link || typeof FontFace === 'undefined') return false
    const files = fontFiles(parseGoogleFontCss(await fetchText(link.href))).filter(
      (f) => f.family.replace(/['"]/g, '') === 'Outfit',
    )
    if (!files.length) return false
    for (const f of files) {
      document.fonts.add(
        new FontFace(TABULAR, `url(${f.url}) format('woff2')`, {
          style: f.style,
          weight: f.weight,
          ...(f.range ? { unicodeRange: f.range } : {}),
          featureSettings: '"tnum"',
        }),
      )
    }
    return true
  })().catch(() => {
    tabularFaces = null // asked again on the next draw
    return false
  })
  return tabularFaces
}

export interface CardFonts {
  /** The page's font stack (Outfit first, the language's own font after it). */
  plain: string
  /** The same with tabular figures (the cards' `tabular-nums`). */
  tabular: string
}

/** How long a card waits for its fonts before drawing with what has loaded. */
const FONT_WAIT_MS = 5000

/**
 * The fonts a card draws with, loaded in `weights`: at most FONT_WAIT_MS (a
 * stalled font server shouldn't hold the PNG; it is then in a fallback font,
 * as the page itself would be).
 */
export async function cardFonts(weights: readonly number[]): Promise<CardFonts> {
  const plain = getComputedStyle(document.body).fontFamily || 'Outfit, sans-serif'
  const outfitFirst = /^\s*["']?Outfit["']?\s*(,|$)/.test(plain)
  const load = async (): Promise<CardFonts> => {
    const tabular = outfitFirst && (await registerTabular()) ? `"${TABULAR}", ${plain}` : plain
    await Promise.all(
      weights.flatMap((w) =>
        [plain, tabular].map((family) =>
          document.fonts.load(`${w} 20px ${family}`).catch(() => undefined),
        ),
      ),
    )
    return { plain, tabular }
  }
  const late = new Promise<CardFonts>((resolve) =>
    setTimeout(() => resolve({ plain, tabular: plain }), FONT_WAIT_MS),
  )
  return Promise.race([load(), late])
}

// ------------------------------------------------------------------ the painter

const ELLIPSIS = '…'

/** The hidden span text with spaces is measured in (Painter.layout). */
let probe: HTMLSpanElement | null = null

/** Whether ctx.filter works here (Safari before 18 ignores it). */
let filterWorks: boolean | null = null
function canFilter(): boolean {
  if (filterWorks !== null) return filterWorks
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 9
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return (filterWorks = false)
  ctx.filter = 'blur(2px)'
  ctx.fillRect(4, 4, 1, 1)
  filterWorks = ctx.getImageData(1, 4, 1, 1).data[3]! > 0
  return filterWorks
}

/**
 * A canvas drawn in CSS pixels at `scale` device pixels each, with the
 * helpers the cards' CSS needs.
 */
export class Painter {
  readonly canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  private readonly metrics = new Map<string, { ascent: number; descent: number }>()
  private readonly layouts = new Map<string, { words: string[]; starts: number[]; width: number }>()

  constructor(
    readonly width: number,
    readonly height: number,
    readonly scale: number,
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = Math.round(width * scale)
    this.canvas.height = Math.round(height * scale)
    this.ctx = this.canvas.getContext('2d')!
    // The picture fills the whole-pixel canvas (296px at 2.7× is 799, not 799.2).
    this.ctx.scale(this.canvas.width / width, this.canvas.height / height)
    this.ctx.imageSmoothingQuality = 'high'
  }

  // -------------------------------------------------- shapes

  /**
   * A box on whole CSS pixels, as Chrome lays out boxes and images before
   * painting them at any scale: the edges rounded (a 187.2px panel gets no
   * soft edge at 1×; at 2.7× the edges land where the page's would).
   */
  snap(x: number, y: number, w: number, h: number): [number, number, number, number] {
    const left = Math.round(x)
    const top = Math.round(y)
    return [left, top, Math.round(x + w) - left, Math.round(y + h) - top]
  }

  path(x: number, y: number, w: number, h: number, r: number | number[] = 0): void {
    this.ctx.beginPath()
    this.ctx.roundRect(...this.snap(x, y, w, h), r)
  }

  fill(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number | number[],
    fill: string | CanvasGradient,
  ) {
    this.path(x, y, w, h, r)
    this.ctx.fillStyle = fill
    this.ctx.fill()
  }

  /** Runs `draw` with the canvas clipped to the rounded box. */
  clipped(x: number, y: number, w: number, h: number, r: number | number[], draw: () => void) {
    this.ctx.save()
    this.path(x, y, w, h, r)
    this.ctx.clip()
    draw()
    this.ctx.restore()
  }

  /** `box-shadow: inset 0 0 0 <width> <color>`: a ring inside the box's edge. */
  insetRing(x: number, y: number, w: number, h: number, r: number, width: number, color: string) {
    this.clipped(x, y, w, h, r, () => {
      this.path(x, y, w, h, r)
      this.ctx.lineWidth = 2 * width
      this.ctx.strokeStyle = color
      this.ctx.stroke()
    })
  }

  /** Paints only the shadow of what `draw` paints (the shape itself lands off the canvas). */
  shadowOf(shadow: Shadow, draw: () => void): void {
    const away = Math.ceil(this.width + 2 * shadow.blur + Math.abs(shadow.x) + 100)
    const ctx = this.ctx
    ctx.save()
    ctx.shadowColor = shadow.color
    ctx.shadowBlur = shadow.blur * this.scale
    ctx.shadowOffsetX = (shadow.x + away) * this.scale
    ctx.shadowOffsetY = shadow.y * this.scale
    ctx.translate(-away, 0)
    draw()
    ctx.restore()
  }

  /**
   * An outer `box-shadow` of a rounded box, `spread` px bigger (a ring is a
   * spread without blur): outside the box only, as CSS draws it.
   */
  boxShadow(x: number, y: number, w: number, h: number, r: number, shadow: Shadow, spread = 0) {
    const ctx = this.ctx
    ctx.save()
    ctx.beginPath()
    ctx.rect(-this.width, -this.height, 3 * this.width, 3 * this.height)
    ctx.roundRect(...this.snap(x, y, w, h), r)
    ctx.clip('evenodd')
    const shape = () =>
      this.fill(
        x - spread,
        y - spread,
        w + 2 * spread,
        h + 2 * spread,
        Math.max(0, r + spread),
        '#000',
      )
    if (shadow.blur || shadow.x || shadow.y) this.shadowOf(shadow, shape)
    else {
      this.path(x - spread, y - spread, w + 2 * spread, h + 2 * spread, Math.max(0, r + spread))
      ctx.fillStyle = shadow.color
      ctx.fill()
    }
    ctx.restore()
  }

  /** Draws `draw` with a CSS `drop-shadow` (the shadow of its alpha, under it). */
  dropShadow(shadow: Shadow, draw: () => void): void {
    const ctx = this.ctx
    ctx.save()
    ctx.shadowColor = shadow.color
    ctx.shadowBlur = shadow.blur * this.scale
    ctx.shadowOffsetX = shadow.x * this.scale
    ctx.shadowOffsetY = shadow.y * this.scale
    draw()
    ctx.restore()
  }

  /**
   * Draws a group as one layer with a drop shadow (stars: fill and edge
   * overlap, so a shadow per shape would double): `draw` paints into a
   * scratch canvas the size of the box, in the box's coordinates.
   */
  layerShadow(
    box: { x: number; y: number; w: number; h: number },
    shadow: Shadow | null,
    draw: (ctx: CanvasRenderingContext2D) => void,
  ) {
    // On whole device pixels, so the layer lands 1:1 (no resampling).
    const s = this.scale
    const left = Math.floor((box.x - 2) * s)
    const top = Math.floor((box.y - 2) * s)
    const layer = document.createElement('canvas')
    layer.width = Math.ceil((box.x + box.w + 2) * s) - left
    layer.height = Math.ceil((box.y + box.h + 2) * s) - top
    const lctx = layer.getContext('2d')!
    lctx.setTransform(s, 0, 0, s, -left, -top)
    draw(lctx)
    const put = () => {
      this.ctx.save()
      this.ctx.setTransform(1, 0, 0, 1, 0, 0)
      this.ctx.drawImage(layer, left, top)
      this.ctx.restore()
    }
    if (shadow) this.dropShadow(shadow, put)
    else put()
  }

  // -------------------------------------------------- pictures

  /** The picture stretched over the box (`size-full`). */
  image(image: CanvasImageSource | null, x: number, y: number, w: number, h: number) {
    if (image) this.ctx.drawImage(image, ...this.snap(x, y, w, h))
  }

  /** The picture scaled to fit the box, centred (`object-contain`). */
  contain(image: ImageBitmap | null, x: number, y: number, w: number, h: number) {
    if (!image) return
    const k = Math.min(w / image.width, h / image.height)
    const dw = image.width * k
    const dh = image.height * k
    this.ctx.drawImage(image, ...this.snap(x + (w - dw) / 2, y + (h - dh) / 2, dw, dh))
  }

  /**
   * The picture scaled to cover the box (`object-cover`), centred unless
   * `anchor` says where the cropped-away part goes: `{ x: 0 }` keeps the
   * left edge whole (`object-position: left`), 1 the right; 0.5 is centred.
   */
  cover(
    image: ImageBitmap | null,
    x: number,
    y: number,
    w: number,
    h: number,
    anchor: { x?: number; y?: number } = {},
  ) {
    if (!image) return
    const k = Math.max(w / image.width, h / image.height)
    const sw = w / k
    const sh = h / k
    const [dx, dy, dw, dh] = this.snap(x, y, w, h)
    this.ctx.drawImage(
      image,
      (image.width - sw) * (anchor.x ?? 0.5),
      (image.height - sh) * (anchor.y ?? 0.5),
      sw,
      sh,
      dx,
      dy,
      dw,
      dh,
    )
  }

  /**
   * Draws `draw` through a CSS filter (`blur(…) saturate(…) brightness(…)`,
   * lengths in CSS px). Where canvas filters don't work (Safari before 18),
   * the blur is made by drawing small and scaling up, and saturation is left
   * out.
   */
  filtered(filter: { blur: number; saturate?: number; brightness?: number }, draw: () => void) {
    const ctx = this.ctx
    if (canFilter()) {
      ctx.save()
      ctx.filter = [
        filter.blur ? `blur(${filter.blur * this.scale}px)` : '',
        filter.saturate !== undefined ? `saturate(${filter.saturate})` : '',
        filter.brightness !== undefined ? `brightness(${filter.brightness})` : '',
      ]
        .filter(Boolean)
        .join(' ')
      draw()
      ctx.restore()
      return
    }
    // Fallback: the layer drawn at 1/k size (a blur by scaling back up, smoothed),
    // brightness by black over it or the layer added to itself; no saturation.
    const k = Math.max(1, filter.blur / 2)
    const small = document.createElement('canvas')
    small.width = Math.max(1, Math.ceil(this.canvas.width / k))
    small.height = Math.max(1, Math.ceil(this.canvas.height / k))
    const sctx = small.getContext('2d')!
    sctx.imageSmoothingQuality = 'high'
    sctx.setTransform(this.scale / k, 0, 0, this.scale / k, 0, 0)
    const main = this.ctx
    this.ctx = sctx
    try {
      draw()
    } finally {
      this.ctx = main
    }
    const b = filter.brightness ?? 1
    sctx.setTransform(1, 0, 0, 1, 0, 0)
    if (b < 1) {
      sctx.globalCompositeOperation = 'source-atop'
      sctx.fillStyle = `rgba(0,0,0,${1 - b})`
      sctx.fillRect(0, 0, small.width, small.height)
    } else if (b > 1) {
      sctx.globalCompositeOperation = 'lighter'
      sctx.globalAlpha = Math.min(1, b - 1)
      sctx.drawImage(small, 0, 0)
    }
    main.save()
    main.imageSmoothingQuality = 'high'
    main.drawImage(small, 0, 0, (small.width * k) / this.scale, (small.height * k) / this.scale)
    main.restore()
  }

  /**
   * `backdrop-filter: blur(…) saturate(…)` on a rounded box: `backdrop` (the
   * card as painted so far, at device size) blurred inside the box.
   */
  backdrop(
    backdrop: CanvasImageSource & { width: number; height: number },
    box: { x: number; y: number; w: number; h: number; r: number },
    blur: number,
    saturate = 1,
  ) {
    const pad = 3 * blur
    const sx = Math.max(0, box.x - pad)
    const sy = Math.max(0, box.y - pad)
    const ex = Math.min(this.width, box.x + box.w + pad)
    const ey = Math.min(this.height, box.y + box.h + pad)
    const s = this.scale
    this.clipped(box.x, box.y, box.w, box.h, box.r, () =>
      this.filtered({ blur, saturate }, () =>
        this.ctx.drawImage(
          backdrop,
          sx * s,
          sy * s,
          (ex - sx) * s,
          (ey - sy) * s,
          sx,
          sy,
          ex - sx,
          ey - sy,
        ),
      ),
    )
  }

  /** A copy of what is painted so far (device pixels), for backdrops. */
  snapshot(): HTMLCanvasElement {
    const copy = document.createElement('canvas')
    copy.width = this.canvas.width
    copy.height = this.canvas.height
    copy.getContext('2d')!.drawImage(this.canvas, 0, 0)
    return copy
  }

  // -------------------------------------------------- text

  /** `letter-spacing` in px (read back from the context, Chrome loses it across save()). */
  private spacing = 0

  /** Runs `draw` with a letter spacing (px). */
  letterSpaced(px: number, draw: () => void): void {
    this.spacing = px
    this.ctx.letterSpacing = `${px}px`
    try {
      draw()
    } finally {
      this.spacing = 0
      this.ctx.letterSpacing = '0px'
    }
  }

  /** Sets the font (`weight size family`) and returns its size. */
  font(weight: number, size: number, family: string): number {
    this.ctx.font = `${weight} ${size}px ${family}`
    return size
  }

  /** The text's width in the current font, as the page lays it out. */
  measure(text: string): number {
    return this.layout(text).width
  }

  /**
   * Where each word of the text starts, and its width. Canvas text shapes
   * word by word and so never kerns across a space, where the page does
   * (Outfit pulls "T" and a space together: "CRIT Rate" is 0.4px narrower at
   * 25px); text with spaces is measured on the page instead (a hidden span,
   * a Range per word) and drawn a word at a time.
   */
  private layout(text: string): { words: string[]; starts: number[]; width: number } {
    const ctx = this.ctx
    if (!text.includes(' '))
      return { words: [text], starts: [0], width: ctx.measureText(text).width }
    const key = `${ctx.font}|${this.spacing}|${text}`
    const known = this.layouts.get(key)
    if (known) return known
    const words = text.split(/(?<= )/)
    if (!probe) {
      probe = document.createElement('span')
      probe.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;white-space:pre'
    }
    if (!probe.isConnected) document.body.append(probe)
    probe.style.font = ctx.font
    probe.style.letterSpacing = `${this.spacing}px`
    probe.textContent = text
    const node = probe.firstChild as Text
    const range = document.createRange()
    const starts: number[] = []
    let index = 0
    for (const word of words) {
      range.setStart(node, 0)
      range.setEnd(node, index)
      starts.push(index ? range.getBoundingClientRect().width : 0)
      index += word.length
    }
    range.setEnd(node, text.length)
    const found = { words, starts, width: range.getBoundingClientRect().width }
    this.layouts.set(key, found)
    return found
  }

  /** Ends a drawing: the page's measuring span goes. */
  done(): void {
    probe?.remove()
  }

  /**
   * The baseline of the current font's text in a CSS line box `lineHeight`
   * tall whose top is `top`: the content area (the font's ascent + descent)
   * centred in the line, as CSS lays a line out.
   */
  baseline(top: number, lineHeight: number): number {
    const key = this.ctx.font
    let m = this.metrics.get(key)
    if (!m) {
      const measured = this.ctx.measureText('')
      m = { ascent: measured.fontBoundingBoxAscent, descent: measured.fontBoundingBoxDescent }
      this.metrics.set(key, m)
    }
    // Chrome floors the half-leading (the ascent and descent are whole px
    // already) and paints the text on a whole CSS px, at any scale.
    return Math.round(top + Math.floor((lineHeight - (m.ascent + m.descent)) / 2) + m.ascent)
  }

  /** The text cut to `max` px with an ellipsis (`text-overflow: ellipsis`). */
  ellipsize(text: string, max: number): string {
    if (this.measure(text) <= max) return text
    let low = 0
    let high = text.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      if (this.measure(text.slice(0, mid) + ELLIPSIS) <= max) low = mid
      else high = mid - 1
    }
    return text.slice(0, low) + ELLIPSIS
  }

  /**
   * Text at (`x`, baseline `y`), with CSS text shadows (painted first, the
   * first on top) and an opacity; returns its width.
   */
  text(
    text: string,
    x: number,
    y: number,
    color: string,
    options: { align?: CanvasTextAlign; shadows?: readonly Shadow[]; alpha?: number } = {},
  ): number {
    const ctx = this.ctx
    const { words, starts, width } = this.layout(text)
    const left =
      options.align === 'right' ? x - width : options.align === 'center' ? x - width / 2 : x
    const paint = () => words.forEach((word, i) => ctx.fillText(word, left + starts[i]!, y))
    ctx.save()
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    if (options.alpha !== undefined) ctx.globalAlpha *= options.alpha
    ctx.fillStyle = color
    for (const shadow of [...(options.shadows ?? [])].reverse()) this.shadowOf(shadow, paint)
    paint()
    ctx.restore()
    return width
  }
}

/**
 * A CSS `linear-gradient(<angle>deg, <colour> <stop>%, …)` over a box, as
 * CSS lays its line: through the centre, long enough that the corners take
 * the end colours. Null for anything else.
 */
export function linearGradient(
  ctx: CanvasRenderingContext2D,
  css: string,
  x: number,
  y: number,
  w: number,
  h: number,
): CanvasGradient | null {
  const m = /^\s*linear-gradient\(\s*([\d.]+)deg\s*,(.*)\)\s*$/.exec(css)
  if (!m) return null
  const angle = (Number(m[1]) * Math.PI) / 180
  const dx = Math.sin(angle)
  const dy = -Math.cos(angle)
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
  const cx = x + w / 2
  const cy = y + h / 2
  const g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half)
  for (const [, color, at] of m[2]!.matchAll(/(rgba?\([^)]*\)|#[0-9a-f]+)\s+([\d.]+)%/gi)) {
    g.addColorStop(Number(at) / 100, color!)
  }
  return g
}

/**
 * The theme's colour tokens (main.css, under `[data-theme]`) as the card
 * resolves them: read off a probe in that theme.
 */
export function themeTokens<K extends string>(
  theme: 'light' | 'dark',
  names: readonly K[],
): Record<K, string> {
  const themed = document.createElement('div')
  themed.dataset.theme = theme
  themed.style.display = 'none'
  document.body.append(themed)
  const style = getComputedStyle(themed)
  const tokens = Object.fromEntries(
    names.map((name) => [name, style.getPropertyValue(`--${name}`).trim()]),
  ) as Record<K, string>
  themed.remove()
  return tokens
}

/** A 24×24 SVG icon path (lucide, the game stars) drawn into a box, filled and/or stroked. */
export function iconPath(
  ctx: CanvasRenderingContext2D,
  d: string,
  x: number,
  y: number,
  size: number,
  style: { fill?: string; stroke?: string; lineWidth?: number },
) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(size / 24, size / 24)
  const path = new Path2D(d)
  if (style.fill) {
    ctx.fillStyle = style.fill
    ctx.fill(path)
  }
  if (style.stroke) {
    ctx.strokeStyle = style.stroke
    ctx.lineWidth = style.lineWidth ?? 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke(path)
  }
  ctx.restore()
}

// ------------------------------------------------------------------ the PNG

/** The share cards' corner radius in CSS px at the 1920px width (the artifact card: its 12px at 2.7×). */
export const CARD_CORNER = 32

/**
 * Cuts the painted card's corners round, `radius` CSS px at `scale`: what
 * lies outside turns transparent, so the PNG (download, copy, share) and
 * the preview drawn from it have the same edge in both themes.
 */
export function roundCorners(canvas: HTMLCanvasElement, radius: number, scale: number): void {
  const ctx = canvas.getContext('2d')!
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'destination-in'
  ctx.fillStyle = '#000'
  ctx.beginPath()
  ctx.roundRect(0, 0, canvas.width, canvas.height, radius * scale)
  ctx.fill()
  ctx.restore()
}

/** The PNG encoder (card-png.worker), started on the first export and kept. */
let encoder: Worker | null = null
let jobs = 0
const pending = new Map<number, { resolve: (blob: Blob) => void; reject: (error: Error) => void }>()

function encodeInWorker(bitmap: ImageBitmap): Promise<Blob> {
  if (!encoder) {
    encoder = new Worker(new URL('./card-png.worker.ts', import.meta.url), { type: 'module' })
    encoder.onmessage = ({ data }: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
      const job = pending.get(data.id)
      pending.delete(data.id)
      if (data.blob) job?.resolve(data.blob)
      else job?.reject(new Error(data.error ?? 'encode failed'))
    }
    // A worker that can't start fails what waits on it, and the next export starts another.
    encoder.onerror = () => {
      encoder = null
      for (const job of pending.values()) job.reject(new Error('encoder failed'))
      pending.clear()
    }
  }
  const id = ++jobs
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    encoder!.postMessage({ id, bitmap }, [bitmap])
  })
}

/**
 * The canvas as a PNG: encoded in a worker (OffscreenCanvas), so the page
 * doesn't stall for the few hundred ms it takes; on the canvas itself where
 * workers can't (older Safari).
 */
export async function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined') {
    try {
      return await encodeInWorker(await createImageBitmap(canvas))
    } catch {
      // the canvas's own encoder below
    }
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
      'image/png',
    ),
  )
}
