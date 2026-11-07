/**
 * The Spiral Abyss and Imaginarium Theater record cards drawn on a canvas,
 * for their PNG and preview (record-card.ts says what goes where). The
 * header and foot are the Stygian card's (stygian-card-canvas.ts) in each
 * mode's own colours: the Abyss's indigo, the Theater's violet. The stars
 * are the game's own art (gi-cdn): the Abyss star drawn in the card's gold,
 * the Theater's Stella as it is; a Stella not earned is grey and faded, so
 * earned or not differs in lightness, never by hue alone.
 */

import type { GiAbyssRecord, GiFigure } from '@gdt/shared'
import { characterMeta, type Element } from '@/data/game-meta'
import { frameSize } from '@/data/profile-card'
import { characterName } from '@/i18n/game-names'
import { t } from '@/i18n'
import { characterIcon, elementIcon, giCdnArt } from '@/lib/assets'
import {
  CARD_CORNER,
  CardImages,
  Painter,
  cardFonts,
  drawQualityCell,
  roundCorners,
  type CardProgress,
} from '@/lib/card-canvas'
import { dateFormat, formatDate, formatNumber } from '@/lib/format'
import { qualityCell } from '@/lib/item-art'
import { CardPaint } from '../characters/card-paint'
import type { CardTheme } from '../characters/share-card'
import {
  ABYSS_LAYOUT,
  RECORD_PILL,
  THEATER_LAYOUT,
  abyssLayout,
  recordBody,
  stellaRowWidth,
  theaterLayout,
} from './record-card'
import {
  PROFILE,
  SEASON_DIM,
  SEASON_FADE,
  STYGIAN_CARD,
  bagCell,
  seasonMonth,
  stygianHeader,
  wrapLines,
} from './stygian-card'
import type { StygianProfile } from './stygian-card-canvas'

export const ABYSS_STAR = 'UI_Icon_Tower_Star'
export const THEATER_STELLA = 'UI_Icon_RoleCombat_Star'

interface RecordBase {
  theme: CardTheme
  profile: StygianProfile
  seasonName: string
  /** The season's start and end, "YYYY-MM-DD hh:mm:ss". */
  start: string
  end: string
  /** The game version it ran in; null unknown. */
  version: string | null
  /** When the capture it comes from was taken (ms). */
  takenAt: number
}

export interface AbyssDrawing extends RecordBase {
  record: GiAbyssRecord
  /** The stars the period could give (36). */
  total: number
  /** The blessing's art (a URL), name line and text (plain). */
  blessing: { art: string; label: string; text: string }
}

export interface TheaterDrawing extends RecordBase {
  /** The difficulty's name ("Lunar Mode"); '' unknown. */
  difficulty: string
  acts: number
  /** The difficulty's acts; 0 unknown. */
  totalActs: number
  stars: number
  maxStars: number
  /** Per act and per extra bout, the Stella earned; null when the capture doesn't list them. */
  stellas: { acts: boolean[]; extra: boolean[] } | null
  /** The season's art (the first Opening Character's namecard, a URL). */
  art: string
  elements: readonly Element[]
  opening: readonly string[]
  guests: readonly string[]
}

export interface DrawnRecord {
  canvas: HTMLCanvasElement
  missing: number
}

type Box = { x: number; y: number; w: number; h: number }
type Rgb = readonly [number, number, number]

interface Palette {
  base: Rgb
  glow: string
  glowEnd: string
  season: readonly [string, string]
  panel: string
  chip: string
  pill: string
  line: string
  text: string
  sub: string
  muted: string
  accent: string
  value: string
  guest: string
  fade: Rgb
  /** Over the Theater band's art. */
  veil: readonly [string, string]
}

const PALETTES: Record<'abyss' | 'theater', Record<CardTheme, Palette>> = {
  abyss: {
    dark: {
      base: [10, 14, 34],
      glow: 'rgba(99,102,241,0.28)',
      glowEnd: 'rgba(99,102,241,0)',
      season: ['rgba(36,46,100,0.95)', 'rgba(20,26,62,0.95)'],
      panel: 'rgba(17,23,52,0.92)',
      chip: 'rgba(255,255,255,0.06)',
      pill: 'rgba(255,255,255,0.07)',
      line: 'rgba(255,255,255,0.12)',
      text: '#f1f5f9',
      sub: '#cbd5e1',
      muted: '#9aa3c2',
      accent: '#a5b4fc',
      value: '#fde68a',
      guest: '#fcd34d',
      fade: [17, 23, 52],
      veil: ['rgba(10,14,34,0.88)', 'rgba(10,14,34,0.62)'],
    },
    light: {
      base: [239, 242, 252],
      glow: 'rgba(99,102,241,0.16)',
      glowEnd: 'rgba(99,102,241,0)',
      season: ['rgba(255,255,255,0.95)', 'rgba(224,231,255,0.95)'],
      panel: 'rgba(255,255,255,0.92)',
      chip: 'rgba(67,56,202,0.06)',
      pill: 'rgba(255,255,255,0.92)',
      line: 'rgba(49,46,129,0.14)',
      text: '#141a3a',
      sub: '#3f4770',
      muted: '#5f6790',
      accent: '#4338ca',
      value: '#a15c07',
      guest: '#a15c07',
      fade: [255, 255, 255],
      veil: ['rgba(255,255,255,0.9)', 'rgba(255,255,255,0.72)'],
    },
  },
  theater: {
    dark: {
      base: [17, 13, 36],
      glow: 'rgba(167,139,250,0.26)',
      glowEnd: 'rgba(167,139,250,0)',
      season: ['rgba(58,40,98,0.95)', 'rgba(30,22,60,0.95)'],
      panel: 'rgba(24,18,46,0.92)',
      chip: 'rgba(255,255,255,0.06)',
      pill: 'rgba(255,255,255,0.07)',
      line: 'rgba(255,255,255,0.12)',
      text: '#f1f5f9',
      sub: '#cbd5e1',
      muted: '#a3a0b8',
      accent: '#ddd6fe',
      value: '#ffd57a',
      guest: '#fcd34d',
      fade: [24, 18, 46],
      veil: ['rgba(17,13,36,0.88)', 'rgba(17,13,36,0.62)'],
    },
    light: {
      base: [247, 243, 253],
      glow: 'rgba(167,139,250,0.16)',
      glowEnd: 'rgba(167,139,250,0)',
      season: ['rgba(255,255,255,0.95)', 'rgba(237,229,252,0.95)'],
      panel: 'rgba(255,255,255,0.92)',
      chip: 'rgba(109,40,217,0.06)',
      pill: 'rgba(255,255,255,0.92)',
      line: 'rgba(76,29,149,0.14)',
      text: '#1f1533',
      sub: '#4c3d68',
      muted: '#6f6288',
      accent: '#6d28d9',
      value: '#a15c07',
      guest: '#a15c07',
      fade: [255, 255, 255],
      veil: ['rgba(255,255,255,0.9)', 'rgba(255,255,255,0.72)'],
    },
  },
}

const CREAM = '#e9e5dc'
const CREAM_INK = '#4a5366'

const rgba = (rgb: Rgb, a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`

/** The Abyss figures in the game's order, with their labels. */
const ABYSS_FIGURES = [
  ['defeats', 'endgame.captured.defeats'],
  ['strike', 'endgame.share.strike'],
  ['damageTaken', 'endgame.captured.damageTaken'],
  ['skills', 'endgame.captured.skills'],
  ['bursts', 'endgame.captured.bursts'],
] as const

export async function drawAbyssCard(
  input: AbyssDrawing,
  scale = 1,
  progress?: CardProgress,
): Promise<DrawnRecord> {
  const r = input.record
  const figures = ABYSS_FIGURES.flatMap(([key, label]) => {
    const figure = r[key]
    return figure ? [{ label: t(label), figure }] : []
  })
  const keys = [
    ...new Set([...r.picked.map((p) => p.key), ...figures.map((f) => f.figure.by ?? '')]),
  ].filter(Boolean)
  const urls = [
    giCdnArt(ABYSS_STAR),
    input.profile.avatar,
    input.profile.frame,
    input.blessing.art,
    ...keys.map((key) => characterIcon(key)),
    ...rarities(r.picked.map((p) => p.key)).map((n) => qualityCell(n)),
  ].filter(Boolean)
  return paint(urls, scale, progress, (p, images, family) => {
    const card = new RecordPainter(p, 'abyss', input, images, family)
    card.ground()
    const header = stygianHeader(card.pillWidth(String(r.stars), input.total))
    card.profile(header.profile)
    card.pill(header.pill, String(r.stars), input.total, (x, y, d) =>
      card.tinted(giCdnArt(ABYSS_STAR), x, y, d),
    )
    card.season(header.season, t('endgame.modes.abyss'))
    const { body, foot } = recordBody()
    card.abyss(body, figures)
    card.foot(foot)
  })
}

export async function drawTheaterCard(
  input: TheaterDrawing,
  scale = 1,
  progress?: CardProgress,
): Promise<DrawnRecord> {
  const cast = [...input.opening, ...input.guests]
  const urls = [
    giCdnArt(THEATER_STELLA),
    input.profile.avatar,
    input.profile.frame,
    input.art,
    ...input.elements.map((e) => elementIcon(e)),
    ...cast.map((key) => characterIcon(key)),
    ...rarities(cast).map((n) => qualityCell(n)),
  ].filter(Boolean)
  return paint(urls, scale, progress, (p, images, family) => {
    const card = new RecordPainter(p, 'theater', input, images, family)
    card.ground()
    const header = stygianHeader(card.pillWidth(String(input.stars), input.maxStars))
    card.profile(header.profile)
    card.pill(header.pill, String(input.stars), input.maxStars, (x, y, d) =>
      p.contain(images.get(giCdnArt(THEATER_STELLA)), x, y, d, d),
    )
    card.season(header.season, t('endgame.modes.theater'))
    const { body, foot } = recordBody()
    card.theater(body, input)
    card.foot(foot)
  })
}

const rarities = (keys: readonly string[]) => [
  ...new Set(keys.map((key) => characterMeta(key)?.[0] ?? 4)),
]

async function paint(
  urls: string[],
  scale: number,
  progress: CardProgress | undefined,
  draw: (p: Painter, images: CardImages, family: string) => void,
): Promise<DrawnRecord> {
  const [images, fonts] = await Promise.all([
    CardImages.load(urls, progress),
    cardFonts([400, 600, 700, 800]),
  ])
  const p = new Painter(STYGIAN_CARD.width, STYGIAN_CARD.height, scale)
  try {
    draw(p, images, fonts.tabular)
    roundCorners(p.canvas, CARD_CORNER, scale)
    return { canvas: p.canvas, missing: images.missing }
  } finally {
    p.done()
    images.close()
  }
}

class RecordPainter extends CardPaint {
  private readonly c: Palette

  constructor(
    p: Painter,
    mode: 'abyss' | 'theater',
    private readonly input: RecordBase,
    images: CardImages,
    family: string,
  ) {
    super(p, input.theme, images, family)
    this.c = PALETTES[mode][input.theme]
  }

  ground() {
    const { ctx } = this.p
    const { width, height } = STYGIAN_CARD
    ctx.fillStyle = rgba(this.c.base, 1)
    ctx.fillRect(0, 0, width, height)
    const r = Math.hypot(width / 2, height) * 0.45
    const glow = ctx.createRadialGradient(width / 2, 0, 0, width / 2, 0, r)
    glow.addColorStop(0, this.c.glow)
    glow.addColorStop(1, this.c.glowEnd)
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, width, height)
  }

  /** The game's art in one colour (the Abyss star: the image's shape filled with the card's gold). */
  tinted(url: string, x: number, y: number, d: number) {
    const image = this.images.get(url)
    if (!image) return
    const k = Math.max(1, this.p.canvas.width / STYGIAN_CARD.width)
    const layer = document.createElement('canvas')
    layer.width = layer.height = Math.round(d * k)
    const ctx = layer.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, 0, 0, layer.width, layer.height)
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = this.c.value
    ctx.fillRect(0, 0, layer.width, layer.height)
    this.p.ctx.drawImage(layer, x, y, d, d)
    layer.width = layer.height = 0
  }

  /** As stygian-card-canvas's: a part on its own layer, kept as much as the fade says. */
  private faded(
    box: Box,
    fade: readonly (readonly [number, number])[],
    fromRight: boolean,
    draw: () => void,
  ) {
    const p = this.p
    const main = p.ctx
    const layer = document.createElement('canvas')
    layer.width = p.canvas.width
    layer.height = p.canvas.height
    const ctx = layer.getContext('2d')!
    ctx.scale(layer.width / STYGIAN_CARD.width, layer.height / STYGIAN_CARD.height)
    ctx.imageSmoothingQuality = 'high'
    p.ctx = ctx
    try {
      p.clipped(box.x, box.y, box.w, box.h, 22, draw)
      const mask = fromRight
        ? ctx.createLinearGradient(box.x + box.w, 0, box.x, 0)
        : ctx.createLinearGradient(box.x, 0, box.x + box.w, 0)
      for (const [at, alpha] of fade) mask.addColorStop(at, `rgba(0,0,0,${alpha})`)
      ctx.globalCompositeOperation = 'destination-in'
      ctx.fillStyle = mask
      ctx.fillRect(box.x, box.y, box.w, box.h)
    } finally {
      p.ctx = main
    }
    main.drawImage(layer, 0, 0, STYGIAN_CARD.width, STYGIAN_CARD.height)
    layer.width = layer.height = 0
  }

  private panel(box: Box, fromRight: boolean) {
    this.faded(box, SEASON_FADE, fromRight, () => {
      const ctx = this.p.ctx
      const half = (box.w + box.h) / 4
      const cx = box.x + box.w / 2
      const cy = box.y + box.h / 2
      const g = fromRight
        ? ctx.createLinearGradient(cx - half, cy - half, cx + half, cy + half)
        : ctx.createLinearGradient(cx + half, cy - half, cx - half, cy + half)
      g.addColorStop(0, this.c.season[0])
      g.addColorStop(1, this.c.season[1])
      ctx.fillStyle = g
      ctx.fillRect(box.x, box.y, box.w, box.h)
      const d = fromRight
        ? ctx.createLinearGradient(box.x + box.w, 0, box.x, 0)
        : ctx.createLinearGradient(box.x, 0, box.x + box.w, 0)
      for (const [at, alpha] of SEASON_DIM) d.addColorStop(at, rgba(this.c.base, alpha))
      ctx.fillStyle = d
      ctx.fillRect(box.x, box.y, box.w, box.h)
    })
  }

  /** The owner, as on the Stygian card: picture in its frame, name, signature, UID. */
  profile(box: Box) {
    const p = this.p
    const { profile } = this.input
    this.panel(box, false)
    const pic = PROFILE.picture
    const px = box.x + pic.x
    const py = box.y + pic.y
    const avatar = this.images.get(profile.avatar)
    if (avatar)
      p.clipped(px, py, pic.d, pic.d, pic.d / 2, () => p.cover(avatar, px, py, pic.d, pic.d))
    const frame = profile.frame ? this.images.get(profile.frame) : null
    if (frame) {
      const size = frameSize(pic.d, frame.width)
      const cx = px + pic.d / 2
      const cy = py + pic.d / 2
      p.clipped(box.x, box.y, box.w, box.h, 22, () =>
        p.contain(frame, cx - size / 2, cy - size / 2, size, size),
      )
    } else if (avatar) {
      p.insetRing(px, py, pic.d, pic.d, pic.d / 2, 3, 'rgba(255,255,255,0.85)')
    }
    const { text } = PROFILE
    const x = box.x + text.left
    const max = box.w - text.left - text.right
    let y = box.y + text.top
    if (profile.name) {
      this.line(profile.name, x, y, 34, 800, this.c.text, { lineHeight: 39, max })
      y += 39 + 6
      if (profile.signature) {
        this.p.font(400, 18, this.family)
        for (const line of wrapLines(profile.signature, max, (s) => this.p.measure(s), 2)) {
          this.line(line, x, y, 18, 400, this.c.sub, { lineHeight: 24.3 })
          y += 24.3
        }
      }
    }
    if (profile.uid)
      this.line(
        t('overview.traveler.uid', { uid: profile.uid }),
        x,
        box.y + box.h - text.bottom - 27,
        18,
        400,
        this.c.sub,
        { lineHeight: 27 },
      )
  }

  private ofText(total: number) {
    return total ? `/ ${total}` : ''
  }

  pillWidth(value: string, total: number): number {
    const P = RECORD_PILL
    const of = this.ofText(total)
    const textW =
      this.textWidth(value, P.value, 800) + (of ? 10 + this.textWidth(of, P.of, 400) : 0)
    return P.padLeft + P.icon + P.gap + textW + P.padRight
  }

  /** The record pill: the game's star and the number (the user's call: nothing else), centred. */
  pill(box: Box, value: string, total: number, icon: (x: number, y: number, d: number) => void) {
    const P = RECORD_PILL
    const p = this.p
    p.fill(box.x, box.y, box.w, box.h, box.h / 2, this.c.pill)
    p.insetRing(box.x, box.y, box.w, box.h, box.h / 2, 1, this.c.line)
    icon(box.x + P.padLeft, box.y + (box.h - P.icon) / 2, P.icon)
    const x = box.x + P.padLeft + P.icon + P.gap
    // The number's line box, centred; "/ 36" on its baseline.
    const top = box.y + (box.h - P.value) / 2
    this.line(value, x, top, P.value, 800, this.c.value, { lineHeight: P.value })
    const of = this.ofText(total)
    if (of) {
      const vw = this.textWidth(value, P.value, 800)
      // Baselines agree: the small text's box sits at the big one's foot.
      this.line(of, x + vw + 10, top + P.value * 0.82 - P.of, P.of, 400, this.c.muted, {
        lineHeight: P.of * 1.2,
      })
    }
  }

  /** The season: mode, month and version; its name; its dates. */
  season(box: Box, mode: string) {
    this.panel(box, true)
    const right = box.x + box.w - 28
    const max = box.w - 50
    const top = box.y + (box.h - (30 + 4 + 50.6 + 4 + 28.5)) / 2
    const labels = [
      mode,
      seasonMonth(this.input.start),
      this.input.version ? t('wishes.history.version', { version: this.input.version }) : '',
    ].filter(Boolean)
    let lx = right
    for (const label of [...labels].reverse()) {
      const w = this.textWidth(label, 20, 700)
      if (lx - w < box.x + 22) break
      this.line(label, lx, top, 20, 700, this.c.accent, { lineHeight: 30, align: 'right' })
      lx -= w + 24
    }
    this.line(this.input.seasonName, right, top + 34, 44, 800, this.c.text, {
      lineHeight: 50.6,
      align: 'right',
      max,
    })
    this.line(
      seasonDates(this.input.start, this.input.end),
      right,
      top + 88.6,
      19,
      400,
      this.c.sub,
      {
        lineHeight: 28.5,
        align: 'right',
      },
    )
  }

  /** The capture's date, and the site. */
  foot(box: Box) {
    this.line(
      t('endgame.captured.fromCapture', { date: formatDate(this.input.takenAt) }),
      box.x,
      box.y,
      17,
      400,
      this.c.muted,
      { lineHeight: box.h },
    )
    this.line('teyvat.me', box.x + box.w, box.y, 17, 700, this.c.sub, {
      lineHeight: box.h,
      align: 'right',
    })
  }

  // -------------------------------------------------------- the Abyss's body

  abyss(body: Box, figures: { label: string; figure: GiFigure }[]) {
    const input = this.input as AbyssDrawing
    const L = ABYSS_LAYOUT
    const { left, rows } = abyssLayout(body)
    const blessing = figures.length ? left : body
    this.blessing(blessing, input)
    if (!figures.length) return
    // The rows a full record fills, the present ones centred among them.
    const shift = ((5 - figures.length) * (rows[0]!.h + L.rowGap)) / 2
    figures.forEach((f, i) => {
      const row = rows[i]!
      this.figureRow({ ...row, y: row.y + shift }, f.label, f.figure)
    })
  }

  private blessing(box: Box, input: AbyssDrawing) {
    const { p } = this
    const ctx = p.ctx
    const c = this.c
    const L = ABYSS_LAYOUT
    p.fill(box.x, box.y, box.w, box.h, 24, c.panel)
    const art = this.images.get(input.blessing.art)
    const artH = L.artH
    p.clipped(box.x, box.y, box.w, artH, [24, 24, 0, 0], () => {
      if (art) p.cover(art, box.x, box.y, box.w, artH)
      const fade = ctx.createLinearGradient(0, box.y + artH * 0.35, 0, box.y + artH)
      fade.addColorStop(0, rgba(c.fade, 0))
      fade.addColorStop(1, rgba(c.fade, 0.94))
      ctx.fillStyle = fade
      ctx.fillRect(box.x, box.y, box.w, artH)
    })
    // The blessing's name line and text, at the art's foot.
    const x = box.x + 32
    const max = box.w - 64
    this.p.font(400, 20, this.family)
    const lines = wrapLines(input.blessing.text, max, (s) => this.p.measure(s), 3)
    let y = box.y + artH - 22 - lines.length * 29
    this.line(input.blessing.label, x, y - 30, 18, 700, c.accent, { lineHeight: 26, max })
    for (const line of lines) {
      this.line(line, x, y, 20, 400, c.text, { lineHeight: 29 })
      y += 29
    }
    // The characters picked most, as bag cells with how often.
    const picked = input.record.picked.slice(0, 4)
    if (picked.length) {
      const n = 4
      const cellW = (box.w - 64 - (n - 1) * L.pickGap) / n
      const cell = bagCell(cellW)
      const areaTop = box.y + artH
      const blockH = 30 + 18 + cell.h
      const top = areaTop + (box.h - artH - blockH) / 2
      this.line(t('endgame.captured.picked'), x, top, 22, 700, c.sub, { lineHeight: 30 })
      picked.forEach((pick, i) =>
        this.cell(pick.key, `×${pick.times}`, x + i * (cellW + L.pickGap), top + 48, cellW),
      )
    }
    p.insetRing(box.x, box.y, box.w, box.h, 24, 1, c.line)
  }

  private figureRow(box: Box, label: string, figure: GiFigure) {
    const { p } = this
    const c = this.c
    const d = ABYSS_LAYOUT.portrait
    p.fill(box.x, box.y, box.w, box.h, 20, c.panel)
    p.insetRing(box.x, box.y, box.w, box.h, 20, 1, c.line)
    const px = box.x + 22
    const py = box.y + (box.h - d) / 2
    p.fill(px, py, d, d, d / 2, c.chip)
    const portrait = figure.by ? this.images.get(characterIcon(figure.by)) : null
    if (portrait) p.clipped(px, py, d, d, d / 2, () => p.cover(portrait, px, py, d, d))
    const value = formatNumber(figure.value)
    const valueW = this.textWidth(value, 60, 800)
    this.line(value, box.x + box.w - 36, box.y + (box.h - 66) / 2, 60, 800, c.text, {
      lineHeight: 66,
      align: 'right',
    })
    const tx = px + d + 28
    const max = box.x + box.w - 36 - valueW - 24 - tx
    const name = figure.by ? characterName(figure.by) : ''
    const blockH = name ? 34 + 4 + 38 : 34
    const top = box.y + (box.h - blockH) / 2
    this.line(label, tx, top, 24, 400, c.sub, { lineHeight: 34, max })
    if (name) this.line(name, tx, top + 38, 28, 700, c.text, { lineHeight: 38, max })
  }

  // ------------------------------------------------------ the Theater's body

  theater(body: Box, input: TheaterDrawing) {
    const { band, cast, cellH } = theaterLayout(body)
    this.band(band, input)
    this.cast(cast, cellH, input)
  }

  /** The season's art under a veil; difficulty and acts, the Stellas, the elements, all centred. */
  private band(box: Box, input: TheaterDrawing) {
    const { p } = this
    const ctx = p.ctx
    const c = this.c
    const L = THEATER_LAYOUT
    const cx = box.x + box.w / 2
    p.fill(box.x, box.y, box.w, box.h, 24, c.panel)
    const art = this.images.get(input.art)
    p.clipped(box.x, box.y, box.w, box.h, 24, () => {
      if (art) p.cover(art, box.x, box.y, box.w, box.h, { y: 0.3 })
      const veil = ctx.createRadialGradient(
        cx,
        box.y + box.h / 2,
        0,
        cx,
        box.y + box.h / 2,
        box.w / 2,
      )
      veil.addColorStop(0, c.veil[0])
      veil.addColorStop(1, c.veil[1])
      ctx.fillStyle = veil
      ctx.fillRect(box.x, box.y, box.w, box.h)
    })
    p.insetRing(box.x, box.y, box.w, box.h, 24, 1, c.line)

    const heading = [
      input.difficulty,
      input.totalActs
        ? t('endgame.captured.actsOf', { n: input.acts, total: input.totalActs })
        : t('endgame.theater.acts', { n: input.acts }),
    ].filter(Boolean)
    const stellaH = input.stellas ? L.stella : 0
    const ICON = 44
    const parts = [38, stellaH, input.elements.length ? ICON : 0].filter(Boolean)
    const GAP = 30
    const blockH = parts.reduce((a, b) => a + b, 0) + GAP * (parts.length - 1)
    let y = box.y + (box.h - blockH) / 2

    // Difficulty (bold) and acts, centred as one line.
    const widths = heading.map((s, i) => this.textWidth(s, 28, i === 0 ? 700 : 400))
    const lineW = widths.reduce((a, b) => a + b, 0) + 28 * (heading.length - 1)
    let x = cx - lineW / 2
    heading.forEach((s, i) => {
      this.line(s, x, y, 28, i === 0 && input.difficulty ? 700 : 400, i === 0 ? c.text : c.sub, {
        lineHeight: 38,
      })
      x += widths[i]! + 28
    })
    y += 38 + GAP

    if (input.stellas) {
      const { acts, extra } = input.stellas
      let sx = cx - stellaRowWidth(acts.length, extra.length) / 2
      const stella = this.images.get(giCdnArt(THEATER_STELLA))
      const one = (earned: boolean) => {
        ctx.save()
        if (!earned) {
          ctx.globalAlpha = 0.35
          ctx.filter = 'grayscale(1)'
        }
        p.contain(stella, sx, y, L.stella, L.stella)
        ctx.restore()
        sx += L.stella + L.stellaGap
      }
      acts.forEach(one)
      if (extra.length && acts.length) {
        sx += L.divider - L.stellaGap
        p.fill(sx, y + 8, 3, L.stella - 16, 1.5, c.line)
        sx += 3 + L.divider
      }
      extra.forEach(one)
      y += L.stella + GAP
    }

    if (input.elements.length) {
      const names = input.elements.map((e) => t(`game.element.${e}`))
      const ws = names.map((n) => ICON + 10 + this.textWidth(n, 26, 400))
      const total = ws.reduce((a, b) => a + b, 0) + 28 * (ws.length - 1)
      let ex = cx - total / 2
      input.elements.forEach((e, i) => {
        p.contain(this.images.get(elementIcon(e)), ex, y, ICON, ICON)
        this.line(names[i]!, ex + ICON + 10, y + (ICON - 34) / 2, 26, 400, c.text, {
          lineHeight: 34,
        })
        ex += ws[i]! + 28
      })
    }
  }

  /** The season's cast: Opening Characters and Special Guest Stars side by side, centred. */
  private cast(box: Box, cellH: number, input: TheaterDrawing) {
    const { p } = this
    const c = this.c
    const L = THEATER_LAYOUT
    p.fill(box.x, box.y, box.w, box.h, 24, c.panel)
    p.insetRing(box.x, box.y, box.w, box.h, 24, 1, c.line)
    const groups = [
      { label: t('endgame.theater.opening'), keys: input.opening, color: c.sub, guest: false },
      { label: t('endgame.theater.guests'), keys: input.guests, color: c.guest, guest: true },
    ].filter((g) => g.keys.length)
    const widthOf = (n: number) => n * L.cell + (n - 1) * L.cellGap
    const total =
      groups.reduce((a, g) => a + widthOf(g.keys.length), 0) +
      (groups.length > 1 ? 2 * L.groupGap + 2 : 0)
    let x = box.x + (box.w - total) / 2
    const top = box.y + L.castPadTop
    groups.forEach((g, gi) => {
      const w = widthOf(g.keys.length)
      this.line(g.label, x + w / 2, top, 22, 700, g.color, {
        lineHeight: L.castLabelH,
        align: 'center',
      })
      const cy = top + L.castLabelH + L.castLabelGap
      g.keys.forEach((key, i) => {
        const cx = x + i * (L.cell + L.cellGap)
        this.cell(key, characterName(key), cx, cy, L.cell)
        if (g.guest)
          p.insetRing(cx - 2, cy - 2, L.cell + 4, cellH + 4, L.cell * 0.07 + 2, 2, c.guest)
      })
      x += w
      if (gi < groups.length - 1) {
        x += L.groupGap
        p.fill(x, top + 8, 2, box.h - L.castPadTop - L.castPadBottom - 8, 1, c.line)
        x += 2 + L.groupGap
      }
    })
  }

  /** A character as the game's bag cell: the portrait over the rarity's art, a word on the cream strip. */
  private cell(key: string, label: string, x: number, y: number, w: number) {
    const { p } = this
    const ctx = p.ctx
    const cell = bagCell(w)
    const rarity = characterMeta(key)?.[0] ?? 4
    const [left, top, width, height] = p.snap(x, y, cell.w, cell.h)
    const stripTop = Math.round(top + height - cell.strip)
    p.clipped(left, top, width, height, cell.r, () => {
      const art = this.images.get(qualityCell(rarity))
      if (art) drawQualityCell(ctx, art, left, top, width, height)
      else p.fill(left, top, width, height, 0, rarity === 5 ? '#b7791f' : '#7c5ab8')
      const portrait = this.images.get(characterIcon(key))
      if (portrait) p.cover(portrait, left, top, width, stripTop - top, { y: 1 })
      const curl = Math.round(cell.curl)
      const cx = left + width - curl
      const cy = stripTop - curl
      ctx.save()
      ctx.beginPath()
      ctx.rect(cx, cy, curl, curl + 1)
      ctx.clip()
      ctx.beginPath()
      ctx.rect(cx, cy, curl, curl + 1)
      ctx.arc(cx, cy, curl, 0, Math.PI * 2)
      ctx.fillStyle = CREAM
      ctx.fill('evenodd')
      ctx.restore()
      p.fill(left, stripTop, width, top + height - stripTop, 0, CREAM)
    })
    this.line(label, left + width / 2, stripTop, cell.levelSize, 700, CREAM_INK, {
      lineHeight: top + height - stripTop,
      align: 'center',
      max: width - 8,
    })
  }
}

/** The season's dates in the site's language ("Jan 16 – Feb 16, 2026"). */
function seasonDates(start: string, end: string): string {
  const day = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
  }
  const from = day(start)
  const to = day(end)
  if (!from || !to) return ''
  return dateFormat({ year: 'numeric', month: 'short', day: 'numeric' }).formatRange(from, to)
}
