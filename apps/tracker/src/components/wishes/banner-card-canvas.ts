/**
 * The banner share card drawn on a canvas, for its PNG and its preview (the
 * user's "Banner pulls share card" design): behind it all, blurred, the
 * banner's own art; the info panel (the owner's plate, the banner art with
 * the second banner of a double run over its corner, version · phase, type
 * and dates, the banner's name, wishes / worth / average 5★ pity, the
 * rarity table, the 50/50 tally); and every 5★ as the game's bag cell: the
 * picture over the cream strip with its pity (coloured by how deep into
 * pity) and its 50/50 mark, the run's pull number in a chip, the outcome's
 * ring around it (solid won, dashed lost, dotted guaranteed, double
 * Capturing Radiance: never colour alone) and the name under it. Geometry in
 * banner-card; the build card's palette and parts (card-paint).
 */

import type { UigfGachaType } from '@gdt/shared'
import { pityBand, type EventBanner, type Outcome } from '@/data/wish-history'
import { itemName } from '@/data/weapons'
import { characterName } from '@/i18n/game-names'
import { t } from '@/i18n'
import {
  CARD_CORNER,
  CardImages,
  Painter,
  cardFonts,
  drawQualityCell,
  linearGradient,
  roundCorners,
  type Shadow,
} from '@/lib/card-canvas'
import { formatDate, formatNumber } from '@/lib/format'
import { RARITY_GRADIENT, qualityCell } from '@/lib/item-art'
import { CardPaint, STAR_SHADOW, parseFilterShadow } from '../characters/card-paint'
import type { CardOwner, CardTheme } from '../characters/share-card'
import { ownerParts } from '../characters/share-card-model'
import { bannerTitle } from '@/data/wish-banner-names'
import {
  bannerArt,
  bannerArtFallback,
  bannerCardLayout,
  tileNameGap,
  tileNameSize,
  tileNumberSize,
  tilePitySize,
  tileRadius,
  type BannerCardNumbers,
} from './banner-card'
import { wishItemName } from './item-name'
import { OUTCOME_STYLE, runDates, wishIcon } from './wish-labels'

export interface BannerDrawing {
  banner: EventBanner
  /** 301, 302 or 500: the 5★ pity bands and whether there is a 50/50. */
  type: UigfGachaType
  phase: number
  numbers: BannerCardNumbers
  theme: CardTheme
  owner: CardOwner
  /** Whether the run is still open (its dates end in "now"). */
  open: boolean
}

export interface DrawnBanner {
  canvas: HTMLCanvasElement
  missing: number
}

const TYPE_SLUG: Record<number, string> = { 301: 'character', 302: 'weapon', 500: 'chronicled' }
const CREAM = '#e9e5dc'
/** Pity on the cream strip by band: dark tones that read on it (early … late). */
const PITY_INK = { early: '#4338ca', mid: '#92400e', soft: '#c2410c', late: '#b91c1c' } as const
/** The 50/50 marks on the cream strip: darker tones of the outcome hues (blue won, amber lost). */
const MARK_INK: Record<Outcome, string> = {
  won: '#1d4ed8',
  lost: '#b45309',
  guaranteed: '#475569',
  radiance: '#4338ca',
}
/** The rings around a tile and the tally's marks, per card theme. */
const OUTCOME_COLOR: Record<CardTheme, Record<Outcome, string>> = {
  dark: { won: '#93c5fd', lost: '#fbbf24', guaranteed: '#e2e8f0', radiance: '#a5b4fc' },
  light: { won: '#2563eb', lost: '#d97706', guaranteed: '#475569', radiance: '#4f46e5' },
}
const OUTCOMES: readonly Outcome[] = ['won', 'lost', 'guaranteed', 'radiance']
/** The banner art behind the card, and the veils over it, per theme. */
const GROUND_FILTER = {
  dark: { blur: 14, saturate: 1.2, brightness: 0.62 },
  light: { blur: 14, saturate: 1.1, brightness: 1.08 },
} as const
const SCRIM_RGB = { dark: '8,11,22', light: '248,250,252' } as const
const ART_SHADOW: Shadow = { x: 0, y: 18, blur: 40, color: 'rgba(0,0,0,0.45)' }
const TILE_SHADOW: Shadow = { x: 0, y: 8, blur: 22, color: 'rgba(0,0,0,0.35)' }
/** The gap between the panel's blocks (kept tight: the banner art takes what is left). */
const GAP = 10
/** The banner art's crop keeps the left edge, where the title is (see `art`). */
const ART_ANCHOR = { x: 0 }

function titleLines(banner: EventBanner): string[] {
  if (banner.kind === 'weapon') return banner.featured5.slice(0, 2).map((key) => itemName(key))
  if (banner.kind === 'character' && banner.name400) {
    return [bannerTitle(banner.name), bannerTitle(banner.name400)]
  }
  return [bannerTitle(banner.name) || banner.featured5.map(characterName).join(' / ')]
}

/**
 * The art to draw: the language's own where gi-cdn has it, else the English
 * one (the probe's picture stays cached for the draw). '' stays ''.
 */
async function artToDraw(url: string): Promise<string> {
  const english = bannerArtFallback(url)
  if (!english) return url
  const probe = await CardImages.load([url])
  const found = probe.get(url) !== null
  probe.close()
  return found ? url : english
}

/** The card at `scale` device pixels per CSS pixel (1: the PNG). */
export async function drawBannerCard(input: BannerDrawing, scale = 1): Promise<DrawnBanner> {
  const layout = bannerCardLayout(input.numbers.fives.length)
  const [art, second] = await Promise.all([
    artToDraw(bannerArt(input.banner)),
    artToDraw(
      input.banner.kind === 'character' && input.banner.name400
        ? bannerArt(input.banner, true)
        : '',
    ),
  ])
  const urls = [
    art,
    second,
    qualityCell(5),
    ...input.numbers.fives.map((f) => wishIcon(f.row.pull.item)),
  ]
  const [images, fonts] = await Promise.all([
    CardImages.load(urls),
    cardFonts([400, 600, 700, 800]),
  ])
  const p = new Painter(layout.width, layout.height, scale)
  try {
    const card = new BannerPainter(p, input, images, fonts.tabular)
    card.ground(layout.width, layout.height, art)
    card.panel(layout.panel, art, second)
    input.numbers.fives.forEach((five, i) =>
      card.tile(five, layout.tiles[i]!, layout.cellW, layout.cellH),
    )
    roundCorners(p.canvas, CARD_CORNER, scale)
    return { canvas: p.canvas, missing: images.missing }
  } finally {
    p.done()
    images.close()
  }
}

class BannerPainter extends CardPaint {
  constructor(
    p: Painter,
    private readonly input: BannerDrawing,
    images: CardImages,
    family: string,
  ) {
    super(p, input.theme, images, family)
  }

  private get hero(): { color: string; shadows: Shadow[] } {
    return {
      color: this.v('--card-hero'),
      shadows: [parseFilterShadow(this.v('--card-hero-shadow'))],
    }
  }

  /** The card's ground: the banner art, blurred, under the theme's veils. */
  ground(width: number, height: number, art: string) {
    const { p, ctx } = this
    ctx.fillStyle = this.v('--card-ground')
    ctx.fillRect(0, 0, width, height)
    const image = this.images.get(art)
    if (image)
      p.filtered(GROUND_FILTER[this.cardTheme], () =>
        p.cover(image, -40, -40, width + 80, height + 80),
      )
    const rgb = SCRIM_RGB[this.cardTheme]
    const across = ctx.createLinearGradient(0, 0, width, 0)
    across.addColorStop(0, `rgba(${rgb},0.30)`)
    across.addColorStop(0.38, `rgba(${rgb},0.55)`)
    across.addColorStop(1, `rgba(${rgb},0.72)`)
    ctx.fillStyle = across
    ctx.fillRect(0, 0, width, height)
    const down = ctx.createLinearGradient(0, 0, 0, height)
    down.addColorStop(0, `rgba(${rgb},0.55)`)
    down.addColorStop(0.26, `rgba(${rgb},0)`)
    down.addColorStop(0.68, `rgba(${rgb},0)`)
    down.addColorStop(1, `rgba(${rgb},0.72)`)
    ctx.fillStyle = down
    ctx.fillRect(0, 0, width, height)
    this.backdropCopy = p.snapshot()
  }

  // -------------------------------------------------- the info panel

  panel(box: { x: number; y: number; w: number; h: number }, art: string, second: string) {
    const { x, w } = box
    let y = box.y
    const rated = this.input.type === 301 || this.input.type === 302
    // What sits under the art, bottom up, so the art takes what is left.
    const lines = titleLines(this.input.banner)
    const titleH = 12 + 34 + 10 + lines.length * 39
    const statsH = 87
    const tableH = 160
    const tallyH = rated ? 68 : 0
    const plateH = 48
    // The plate is one line now (the user's call, 2026-11-04): the art moves up by the line it saved
    // and keeps its height, so a double run's second banner stays clear of the pills under it.
    const lift = this.input.owner.name ? 24 : 0
    const below = titleH + GAP + statsH + GAP + tableH + (rated ? GAP + tallyH : 0)
    const artH = box.h - (plateH + lift) - GAP - below

    this.plate(x, y, w, plateH)
    y += plateH + GAP
    this.art(x, y, w, artH, art, second)
    y += artH + lift
    this.title(x, y + 12, w, lines)
    y += titleH + GAP
    this.stats(x, y, w, statsH)
    y += statsH + GAP
    this.table(x, y, w, tableH)
    y += tableH + GAP
    if (rated) this.tally(x, y, w, tallyH)
  }

  /** The owner on one line: the name at the left, UID · AR · date · teyvat.me at the right. */
  private plate(x: number, y: number, w: number, h: number) {
    this.glass(x, y, w, h, 16, 'panel')
    const owner = this.input.owner
    const text = this.v('--card-text')
    const muted = this.v('--card-muted')
    const secondary = this.v('--card-secondary')
    const top = y + (h - 22) / 2
    const meta = [
      ...ownerParts({ name: null, uid: owner.uid, ar: owner.ar }),
      formatDate(Date.now()),
    ]
    const brandW = this.textWidth('teyvat.me', 15, 700)
    this.line('teyvat.me', x + w - 18, top, 15, 700, secondary, { lineHeight: 22, align: 'right' })
    const metaText = `${meta.join(' · ')} · `
    this.line(metaText, x + w - 18 - brandW, top, 15, 400, muted, {
      lineHeight: 22,
      align: 'right',
    })
    if (owner.name) {
      const metaW = brandW + this.textWidth(metaText, 15, 400)
      this.line(
        ownerParts({ name: owner.name, uid: null, ar: null })[0]!,
        x + 18,
        y + (h - 28) / 2,
        22,
        700,
        text,
        { lineHeight: 28, max: w - 36 - metaW - 16 },
      )
    }
  }

  /**
   * The banner's art, rounded and lifted; a double run's second banner over
   * its corner. The art keeps its left edge: HoYoLAB's pictures are 16:9 or
   * a wider 1080x533 frame, and the banner's title sits at the left, so a
   * centred crop of the wide ones cut it (a Thai card, 2026-11-05).
   */
  private art(x: number, y: number, w: number, h: number, main: string, second: string) {
    const { p } = this
    p.boxShadow(x, y, w, h, 20, ART_SHADOW)
    const image = this.images.get(main)
    p.clipped(x, y, w, h, 20, () => {
      if (image) p.cover(image, x, y, w, h, ART_ANCHOR)
      else p.fill(x, y, w, h, 0, this.v('--card-panel'))
    })
    p.insetRing(x, y, w, h, 20, 1, 'rgba(255,255,255,0.12)')
    const other = second ? this.images.get(second) : null
    if (!other) return
    const sw = Math.round(w * 0.36)
    const sh = Math.round((sw * 9) / 16)
    const sx = x + w - 18 - sw
    const sy = y + h + 22 - sh
    p.boxShadow(sx, sy, sw, sh, 14, { x: 0, y: 10, blur: 28, color: 'rgba(0,0,0,0.55)' })
    p.fill(sx - 3, sy - 3, sw + 6, sh + 6, 17, this.v('--card-ground'))
    p.clipped(sx, sy, sw, sh, 14, () => p.cover(other, sx, sy, sw, sh, ART_ANCHOR))
  }

  /** Version · phase, the banner type and its dates as pills, then its name. */
  private title(x: number, y: number, w: number, lines: readonly string[]) {
    const b = this.input.banner
    const pills = [
      {
        text: `${t('wishes.history.version', { version: b.version })} · ${t('wishes.history.phase', { n: this.input.phase })}`,
        weight: 700,
        color: this.v('--card-text'),
      },
      {
        text: t(`wishes.banners.${TYPE_SLUG[this.input.type] ?? 'character'}.title`),
        weight: 600,
        color: this.v('--card-secondary'),
      },
      {
        text: runDates({ banner: b, pulls: 0, fives: [] }, this.input.open, Number.NaN),
        weight: 400,
        color: this.v('--card-secondary'),
      },
    ]
    let px = x
    for (const pill of pills) {
      const pw = this.textWidth(pill.text, 16, pill.weight) + 28
      if (px + pw > x + w) break
      this.p.fill(px, y, pw, 34, 17, this.v('--card-pill'))
      this.p.insetRing(
        px,
        y,
        pw,
        34,
        17,
        1,
        this.cardTheme === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.12)',
      )
      this.line(pill.text, px + 14, y + 5, 16, pill.weight, pill.color, { lineHeight: 24 })
      px += pw + 8
    }
    const hero = this.hero
    lines.forEach((text, i) => {
      this.line(text, x, y + 44 + i * 39, 36, 800, hero.color, {
        lineHeight: 39,
        shadows: hero.shadows,
        max: w,
      })
    })
  }

  /** Wishes, what they were worth, the average 5★ pity. */
  private stats(x: number, y: number, w: number, h: number) {
    const n = this.input.numbers
    const boxW = (w - 2 * 12) / 3
    const cells = [
      {
        label: t('wishes.share.wishes'),
        value: formatNumber(n.wishes),
        color: this.v('--card-text'),
        primo: false,
      },
      {
        label: t('wishes.share.worth'),
        value: formatNumber(n.wishes * 160),
        color: this.v('--card-text'),
        primo: true,
      },
      {
        label: t('wishes.overview.avgPity'),
        value: n.five.count ? n.five.avgPity.toFixed(1) : '—',
        color: this.cardTheme === 'dark' ? '#fdba74' : '#c2410c',
        primo: false,
      },
    ]
    cells.forEach((cell, i) => {
      const bx = x + i * (boxW + 12)
      this.glass(bx, y, boxW, h, 16, 'panel')
      this.line(cell.label, bx + 20, y + 16, 13, 400, this.v('--card-muted'), {
        lineHeight: 20,
        max: boxW - 40,
      })
      const vw = this.line(cell.value, bx + 20, y + 40, 28, 800, cell.color, { lineHeight: 31 })
      if (cell.primo)
        this.line(
          '✦',
          bx + 20 + vw + 6,
          y + 45,
          18,
          700,
          this.cardTheme === 'dark' ? '#c4b5fd' : '#7c3aed',
          { lineHeight: 22 },
        )
    })
  }

  /** paimon.moe's table: 5★ and 4★ (characters, weapons) with their share and average pity. */
  private table(x: number, y: number, w: number, h: number) {
    this.glass(x, y, w, h, 16, 'panel')
    const n = this.input.numbers
    const left = x + 24
    const cols = [x + w - 24 - 230, x + w - 24 - 110, x + w - 24]
    const muted = this.v('--card-muted')
    const text = this.v('--card-text')
    const secondary = this.v('--card-secondary')
    let top = y + 14
    this.line(t('wishes.rarity'), left, top, 13, 400, muted, { lineHeight: 20 })
    ;[t('wishes.share.total'), t('wishes.share.share'), t('wishes.share.avgPity')].forEach(
      (head, i) =>
        this.line(head, cols[i]!, top, 13, 400, muted, { lineHeight: 20, align: 'right' }),
    )
    top += 24
    const pct = (share: number) => `${(share * 100).toFixed(1)}%`
    const rows = [
      { stars: 5, label: '', row: n.five, size: 17, weight: 800, color: this.tokens['game-star'] },
      {
        stars: 4,
        label: '',
        row: n.four,
        size: 17,
        weight: 800,
        color: this.cardTheme === 'dark' ? '#c4b5fd' : '#7c3aed',
      },
      {
        stars: 0,
        label: `└ ${t('wishes.table.character')}`,
        row: n.fourCharacter,
        size: 15,
        weight: 400,
        color: secondary,
      },
      {
        stars: 0,
        label: `└ ${t('wishes.table.weapon')}`,
        row: n.fourWeapon,
        size: 15,
        weight: 400,
        color: secondary,
      },
    ]
    for (const r of rows) {
      const lh = r.stars ? 26 : 22
      if (r.stars) this.stars(r.stars, left, top + 4, 17, 2, STAR_SHADOW)
      else this.line(r.label, left + 14, top, r.size, 400, secondary, { lineHeight: lh })
      const values = [
        formatNumber(r.row.count),
        pct(r.row.share),
        r.row.count ? r.row.avgPity.toFixed(1) : '—',
      ]
      values.forEach((value, i) =>
        this.line(
          value,
          cols[i]!,
          top,
          r.size,
          r.weight,
          i === 0 && r.stars ? r.color : r.stars ? text : secondary,
          {
            lineHeight: lh,
            align: 'right',
          },
        ),
      )
      top += lh + 4
    }
  }

  /** The 5★ 50/50s: won, lost, guaranteed, Capturing Radiance, each with its mark. */
  private tally(x: number, y: number, w: number, h: number) {
    const boxW = (w - 3 * 10) / 4
    const colors = OUTCOME_COLOR[this.cardTheme]
    OUTCOMES.forEach((outcome, i) => {
      const bx = x + i * (boxW + 10)
      this.glass(bx, y, boxW, h, 16, 'panel')
      const value = `${OUTCOME_STYLE[outcome].mark} ${this.input.numbers.outcomes[outcome]}`
      this.line(value, bx + boxW / 2, y + 10, 22, 800, colors[outcome], {
        lineHeight: 30,
        align: 'center',
      })
      const label =
        outcome === 'radiance' ? t('wishes.share.radiance') : t(`wishes.outcomes.${outcome}`)
      this.line(label, bx + boxW / 2, y + 40, 13, 400, this.v('--card-secondary'), {
        lineHeight: 18,
        align: 'center',
        max: boxW - 12,
      })
    })
  }

  // -------------------------------------------------- one 5★

  tile(
    five: BannerCardNumbers['fives'][number],
    at: { x: number; y: number },
    w: number,
    h: number,
  ) {
    const { p, ctx } = this
    const { x, y } = at
    const r = tileRadius(w)
    const row = five.row
    const outcome = row.outcome
    // The outcome's ring, 3px out: solid / dashed / dotted / double.
    if (outcome) this.ring(x, y, w, h, r, outcome)
    p.boxShadow(x, y, w, h, r, TILE_SHADOW)
    p.clipped(x, y, w, h, r, () => {
      const cell = this.images.get(qualityCell(5))
      if (cell) drawQualityCell(ctx, cell, ...p.snap(x, y, w, h))
      else {
        ctx.fillStyle = linearGradient(ctx, RARITY_GRADIENT[5]!, x, y, w, h) ?? '#b45309'
        ctx.fillRect(x, y, w, h)
      }
      p.cover(this.images.get(wishIcon(row.pull.item)), x, y, w, w)
      ctx.fillStyle = CREAM
      ctx.fillRect(x, y + w, w, h - w)
    })
    // The pity, centred on the strip; the 50/50 mark at its right end.
    const stripTop = y + w
    const stripH = h - w
    const size = tilePitySize(w)
    const band = pityBand(row.pity, this.input.type)
    this.line(
      String(row.pity),
      x + w / 2,
      stripTop + (stripH - size * 1.2) / 2,
      size,
      800,
      PITY_INK[band],
      {
        lineHeight: size * 1.2,
        align: 'center',
      },
    )
    if (outcome) {
      this.line(
        OUTCOME_STYLE[outcome].mark,
        x + w * 0.92,
        stripTop + (stripH - size * 1.2) / 2,
        size * 0.9,
        800,
        MARK_INK[outcome],
        {
          lineHeight: size * 1.2,
          align: 'right',
        },
      )
    }
    // The run's pull number in a chip at the top left.
    const ns = tileNumberSize(w)
    const label = `#${formatNumber(five.number)}`
    const cw = this.textWidth(label, ns, 700) + 14
    const ch = Math.round(ns * 1.5)
    const cx = x + w * 0.05
    const cy = y + w * 0.05
    p.fill(cx, cy, cw, ch, ch / 2, 'rgba(10,14,26,0.82)')
    p.insetRing(cx, cy, cw, ch, ch / 2, 1, 'rgba(255,255,255,0.18)')
    this.line(label, cx + 7, cy, ns, 700, '#f8fafc', { lineHeight: ch })
    // The name under the cell, clear of the ring.
    const hero = this.hero
    const nameSize = tileNameSize(w)
    this.line(
      wishItemName(row.pull.item),
      x + w / 2,
      y + h + tileNameGap(w),
      nameSize,
      700,
      hero.color,
      {
        lineHeight: nameSize * 1.15,
        align: 'center',
        shadows: hero.shadows,
        max: w + 24,
      },
    )
  }

  private ring(x: number, y: number, w: number, h: number, r: number, outcome: Outcome) {
    const ctx = this.ctx
    const color = OUTCOME_COLOR[this.cardTheme][outcome]
    const stroke = (inset: number, width: number, dash: number[], cap: CanvasLineCap = 'butt') => {
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.lineCap = cap
      ctx.setLineDash(dash)
      ctx.beginPath()
      ctx.roundRect(x - inset, y - inset, w + 2 * inset, h + 2 * inset, r + inset)
      ctx.stroke()
      ctx.restore()
    }
    if (outcome === 'radiance') {
      stroke(4, 2, [])
      stroke(8, 2, [])
    } else if (outcome === 'lost') stroke(4.5, 3, [9, 6])
    else if (outcome === 'guaranteed') stroke(4.5, 3, [0.01, 6.5], 'round')
    else stroke(4.5, 3, [])
  }
}
