/**
 * The roster share card drawn straight onto a canvas: every character as the
 * game's bag cell under a header with the owner and the counts. Drawing a
 * hundred cells as DOM through modern-screenshot (clone, inline, SVG, raster,
 * twice) took seconds and froze the page; a canvas draws them in a few
 * frames. The preview is this same picture, so the PNG is ready the moment
 * it shows. Layout and look follow the DOM card it replaced (cell sizes in
 * `cqw`: a hundredth of a cell's width).
 */

import type { TalentLevel } from '@/data/character-build'
import type { CharacterView } from '@/data/characters'
import type { Element } from '@/data/game-meta'
import { characterIcon, elementIcon, elementIconLight } from '@/lib/assets'
import { CARD_CORNER, canvasPng, roundCorners } from '@/lib/card-canvas'
import { qualityCell } from '@/lib/item-art'
import {
  ROSTER_GAP,
  ROSTER_PAD,
  ROSTER_TILE,
  rosterColumns,
  rosterSummary,
  rosterWidth,
} from './roster-card'
import { CARD_THEMES, type CardOwner, type CardTheme } from './share-card'

export interface RosterDrawing {
  characters: readonly CharacterView[]
  /** Each character's talents as the game shows them (by key). */
  talents: ReadonlyMap<string, readonly TalentLevel[]>
  theme: CardTheme
  owner: CardOwner
  /** "Mar 3, 2026", or null without a capture time. */
  date: string | null
  labels: { title: string; c6: string; level90: string }
}

export interface DrawnRoster {
  canvas: HTMLCanvasElement
  /** Images that couldn't be loaded (drawn without them). */
  missing: number
  /** The card's size in CSS pixels. */
  width: number
  height: number
}

const TILE_H = (ROSTER_TILE * 98) / 80
const CQW = ROSTER_TILE / 100
const CREAM = '#e9e5dc'
/** Colours of the game's cells under a picture that failed (RARITY_GRADIENT's two stops). */
const RARITY_STOPS: Record<number, [string, string]> = {
  5: ['#8a5a34', '#c98a46'],
  4: ['#5a4b84', '#9b74c9'],
  3: ['#3f5a7e', '#5c8ec2'],
  2: ['#3f6150', '#5f9474'],
  1: ['#545a66', '#828999'],
}
/** Text colours the card's header uses (the app's tokens, per card theme). */
const RARITY_TEXT: Record<CardTheme, Record<number, string>> = {
  dark: { 5: '#fbbf24', 4: '#c4b5fd' },
  light: { 5: '#b45309', 4: '#7c3aed' },
}
/** The C3/C5 talent boost on the tiles' dark chips (the dark theme's token). */
const BOOST = '#67e8f9'
/** A low book level (TalentLevel.low) on those chips: the dark theme's muted text. */
const LOW = '#94a3b8'
/** A base-9 talent's silver ring on those chips (the dark theme's token). */
const SILVER = '#c5ccd7'
const GOLD = { from: '#fcde54', to: '#f0cc4e', text: '#8a4e24' }

// ------------------------------------------------------------------ images

const bitmaps = new Map<string, Promise<ImageBitmap | null>>()

/**
 * A CORS image as a bitmap (both hosts send CORS), kept for the next draw;
 * null when it fails. `square` decodes a square picture straight to that many
 * pixels: the portraits are 256 px and drawn at 174, and a hundred of them
 * stay in memory for the visit.
 */
function bitmap(url: string, square?: number): Promise<ImageBitmap | null> {
  if (!url) return Promise.resolve(null)
  const id = square ? `${url}@${square}` : url
  let found = bitmaps.get(id)
  if (!found) {
    found = (async () => {
      for (const cache of ['default', 'reload'] as const) {
        try {
          const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache })
          if (!response.ok) continue
          const blob = await response.blob()
          return await (square
            ? createImageBitmap(blob, {
                resizeWidth: square,
                resizeHeight: square,
                resizeQuality: 'high',
              })
            : createImageBitmap(blob))
        } catch {
          // once more past the HTTP cache (a copy cached without CORS)
        }
      }
      bitmaps.delete(id)
      return null
    })()
    bitmaps.set(id, found)
  }
  return found
}

// ------------------------------------------------------------------ drawing helpers

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | [number, number, number, number],
) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** The image scaled to cover the box (object-fit: cover). */
function drawCover(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.max(w / image.width, h / image.height)
  const sw = w / scale
  const sh = h / scale
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h)
}

function font(weight: number, size: number, family: string): string {
  return `${weight} ${size}px ${family}`
}

/** A text chip: rounded box, centred text; returns its width. */
function chip(
  ctx: CanvasRenderingContext2D,
  text: string,
  box: {
    x: number
    y: number
    h: number
    minW: number
    padX: number
    r: number
    align: 'left' | 'right' | 'center'
  },
  style: {
    fill: string | CanvasGradient
    color: string
    font: string
    shadow?: [string, number, number]
    /** An inner ring: colour and width. */
    ring?: [string, number]
  },
): number {
  ctx.font = style.font
  const w = Math.max(box.minW, ctx.measureText(text).width + 2 * box.padX)
  const x = box.align === 'right' ? box.x - w : box.align === 'center' ? box.x - w / 2 : box.x
  ctx.save()
  if (style.shadow) {
    ctx.shadowColor = style.shadow[0]
    ctx.shadowBlur = style.shadow[1]
    ctx.shadowOffsetY = style.shadow[2]
  }
  ctx.fillStyle = style.fill
  roundRect(ctx, x, box.y, w, box.h, box.r)
  ctx.fill()
  ctx.restore()
  if (style.ring) {
    const [color, width] = style.ring
    ctx.strokeStyle = color
    ctx.lineWidth = width
    roundRect(ctx, x + width / 2, box.y + width / 2, w - width, box.h - width, box.r - width / 2)
    ctx.stroke()
  }
  ctx.fillStyle = style.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x + w / 2, box.y + box.h / 2 + box.h * 0.04)
  return w
}

function goldGradient(ctx: CanvasRenderingContext2D, y: number, h: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, y, 0, y + h)
  g.addColorStop(0, GOLD.from)
  g.addColorStop(1, GOLD.to)
  return g
}

function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

// ------------------------------------------------------------------ the card

interface Images {
  cell: Map<number, ImageBitmap | null>
  portrait: Map<string, ImageBitmap | null>
  /** The tiles' light icons (the game's character list). */
  element: Map<Element, ImageBitmap | null>
  /** The header pills' ringed icons, which read on a white pill too. */
  pill: Map<Element, ImageBitmap | null>
}

/** How far the pictures have come: loaded (or failed) of all. */
export type RosterProgress = (loaded: number, total: number) => void

async function loadImages(
  characters: readonly CharacterView[],
  scale: number,
  progress?: RosterProgress,
): Promise<Images & { missing: number }> {
  let missing = 0
  let loaded = 0
  let total = 0
  const counted = async <K>(
    map: Map<K, ImageBitmap | null>,
    key: K,
    url: string,
    square?: number,
  ) => {
    const image = await bitmap(url, square)
    if (url && !image) missing++
    map.set(key, image)
    progress?.(++loaded, total)
  }
  const images: Images = {
    cell: new Map(),
    portrait: new Map(),
    element: new Map(),
    pill: new Map(),
  }
  const rarities = new Set(characters.map((c) => c.rarity ?? 0).filter((r) => r > 0))
  const elements = new Set(characters.flatMap((c) => (c.element ? [c.element] : [])))
  const jobs = [
    ...[...rarities].map((r) => () => counted(images.cell, r, qualityCell(r))),
    ...[...elements].map((e) => () => counted(images.element, e, elementIconLight(e))),
    ...[...elements].map((e) => () => counted(images.pill, e, elementIcon(e))),
    ...characters.map(
      (c) => () =>
        counted(images.portrait, c.key, characterIcon(c.key), Math.round(ROSTER_TILE * scale)),
    ),
  ]
  total = jobs.length
  progress?.(0, total)
  await Promise.all(jobs.map((job) => job()))
  return { ...images, missing }
}

/** Draws the card at `scale` device pixels per CSS pixel; `progress` follows the pictures. */
export async function drawRoster(
  input: RosterDrawing,
  scale: number,
  progress?: RosterProgress,
): Promise<DrawnRoster> {
  const family = getComputedStyle(document.body).fontFamily || 'Outfit, sans-serif'
  const [images] = await Promise.all([
    loadImages(input.characters, scale, progress),
    Promise.all(
      ['400', '600', '700'].map((w) =>
        document.fonts.load(`${w} 20px ${family}`).catch(() => undefined),
      ),
    ),
  ])
  const theme = CARD_THEMES[input.theme]
  const columns = rosterColumns(input.characters.length)
  const width = rosterWidth(columns)
  const inner = width - 2 * ROSTER_PAD
  const summary = rosterSummary(input.characters)

  const measure = document.createElement('canvas').getContext('2d')!

  // Header: the title row, then the count pills (wrapping like flex-wrap).
  const TITLE_ROW = 33 + 4 + 24 // owner line (22px × 1.5) + gap + date line (16px × 1.5)
  const PILL_H = 40
  const PILL_GAP = 10
  measure.font = font(600, 20, family)
  interface Pill {
    w: number
    draw: (ctx: CanvasRenderingContext2D, x: number, y: number) => void
  }
  const pills: Pill[] = []
  const pillBox = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number) => {
    ctx.fillStyle = theme['--card-pill']!
    roundRect(ctx, x, y, w, PILL_H, PILL_H / 2)
    ctx.fill()
  }
  const textPill = (lead: string, leadColor: string, count: number) => {
    const leadW = measure.measureText(lead).width
    const countW = measure.measureText(String(count)).width
    const w = 16 + leadW + 8 + countW + 16
    pills.push({
      w,
      draw: (ctx, x, y) => {
        pillBox(ctx, x, y, w)
        ctx.font = font(600, 20, family)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = leadColor
        ctx.fillText(lead, x + 16, y + PILL_H / 2 + 1)
        ctx.fillStyle = theme['--card-text']!
        ctx.fillText(String(count), x + 16 + leadW + 8, y + PILL_H / 2 + 1)
      },
    })
  }
  for (const e of summary.elements) {
    const countW = measure.measureText(String(e.count)).width
    const w = 16 + 26 + 8 + countW + 16
    pills.push({
      w,
      draw: (ctx, x, y) => {
        pillBox(ctx, x, y, w)
        const icon = images.pill.get(e.element)
        if (icon) ctx.drawImage(icon, x + 16, y + (PILL_H - 26) / 2, 26, 26)
        ctx.font = font(600, 20, family)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = theme['--card-text']!
        ctx.fillText(String(e.count), x + 16 + 26 + 8, y + PILL_H / 2 + 1)
      },
    })
  }
  if (summary.elements.length) {
    pills.push({
      w: 1 + 8, // the divider with its 4px margins
      draw: (ctx, x, y) => {
        ctx.fillStyle = theme['--card-divider']!
        ctx.fillRect(x + 4, y + (PILL_H - 28) / 2, 1, 28)
      },
    })
  }
  for (const r of summary.rarities) {
    textPill(`${r.rarity}★`, RARITY_TEXT[input.theme][r.rarity] ?? theme['--card-muted']!, r.count)
  }
  textPill(input.labels.c6, theme['--card-muted']!, summary.c6)
  textPill(input.labels.level90, theme['--card-muted']!, summary.level90)

  const pillRows: { pill: Pill; x: number; row: number }[] = []
  let px = 0
  let row = 0
  for (const pill of pills) {
    if (px > 0 && px + pill.w > inner) {
      px = 0
      row++
    }
    pillRows.push({ pill, x: px, row })
    px += pill.w + PILL_GAP
  }
  const pillsH = (row + 1) * PILL_H + row * PILL_GAP
  const headerH = TITLE_ROW + 20 + pillsH
  const rows = Math.ceil(input.characters.length / columns)
  const gridTop = ROSTER_PAD + headerH + 28
  const height = Math.ceil(
    gridTop + rows * TILE_H + Math.max(0, rows - 1) * ROSTER_GAP + ROSTER_PAD,
  )

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)

  // Ground and the soft glows (the app's accent and brand colours).
  ctx.fillStyle = theme['--card-ground']!
  ctx.fillRect(0, 0, width, height)
  const glow = (cx: number, cy: number, rx: number, ry: number, rgb: string, alpha: number) => {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.scale(1, ry / rx)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
    g.addColorStop(0, `rgba(${rgb},${alpha})`)
    g.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = g
    ctx.fillRect(-rx, -rx, 2 * rx, 2 * rx)
    ctx.restore()
  }
  const dark = input.theme === 'dark'
  glow(width * 0.15, -height * 0.15, 1100, 560, '99,102,241', dark ? 0.28 : 0.18)
  glow(width * 0.95, -height * 0.1, 900, 480, '245,158,11', dark ? 0.16 : 0.14)

  // Title row: "Characters 103" at the left, the owner and the date at the right (bottoms aligned).
  const rowBottom = ROSTER_PAD + TITLE_ROW
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = theme['--card-text']!
  ctx.font = font(700, 44, family)
  const titleBase = rowBottom - 8
  ctx.fillText(input.labels.title, ROSTER_PAD, titleBase)
  const titleW = ctx.measureText(input.labels.title).width
  ctx.font = font(600, 32, family)
  ctx.fillStyle = theme['--card-muted']!
  ctx.fillText(String(input.characters.length), ROSTER_PAD + titleW + 16, titleBase)

  ctx.textAlign = 'right'
  const right = width - ROSTER_PAD
  const dateParts = [input.date, 'teyvat.me'].filter((p): p is string => !!p)
  ctx.font = font(400, 16, family)
  ctx.fillStyle = theme['--card-muted']!
  ctx.fillText(dateParts.join('  ·  '), right, rowBottom - 6)
  const ownerParts = [
    input.owner.name,
    input.owner.ar ? `AR ${input.owner.ar}` : null,
    input.owner.uid ? `UID ${input.owner.uid}` : null,
  ].filter((p): p is string => !!p)
  if (ownerParts.length) {
    // The name semibold, the rest regular, "·" between them at 60%.
    let x = right
    const ownerBase = rowBottom - 24 - 4 - 9
    for (let i = ownerParts.length - 1; i >= 0; i--) {
      const bold = i === 0 && !!input.owner.name
      ctx.font = font(bold ? 600 : 400, 22, family)
      ctx.fillStyle = theme['--card-text']!
      ctx.fillText(ownerParts[i]!, x, ownerBase)
      x -= ctx.measureText(ownerParts[i]!).width
      if (i > 0) {
        ctx.font = font(400, 22, family)
        ctx.globalAlpha = 0.6
        ctx.fillText('·', x - 12, ownerBase)
        ctx.globalAlpha = 1
        x -= 12 + ctx.measureText('·').width + 12
      }
    }
  }

  // Count pills.
  const pillsTop = rowBottom + 20
  for (const { pill, x, row: r } of pillRows)
    pill.draw(ctx, ROSTER_PAD + x, pillsTop + r * (PILL_H + PILL_GAP))

  // The cells.
  input.characters.forEach((c, index) => {
    const x = ROSTER_PAD + (index % columns) * (ROSTER_TILE + ROSTER_GAP)
    const y = gridTop + Math.floor(index / columns) * (TILE_H + ROSTER_GAP)
    drawTile(ctx, c, input.talents.get(c.key) ?? [], images, x, y, family)
  })

  // The same share of its width as on the 1920px cards.
  roundCorners(canvas, (CARD_CORNER * width) / 1920, scale)
  return { canvas, missing: images.missing, width, height }
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  c: CharacterView,
  talents: readonly TalentLevel[],
  images: Images,
  x: number,
  y: number,
  family: string,
) {
  const W = ROSTER_TILE
  const H = TILE_H
  const R = 7 * CQW

  // Shadow and the rarity cell.
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.18)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 2
  roundRect(ctx, x, y, W, H, R)
  const stops = RARITY_STOPS[c.rarity ?? 0] ?? RARITY_STOPS[1]!
  const fallback = ctx.createLinearGradient(x, y, x + W * 0.5, y + H)
  fallback.addColorStop(0, stops[0])
  fallback.addColorStop(1, stops[1])
  ctx.fillStyle = fallback
  ctx.fill()
  ctx.restore()
  ctx.save()
  roundRect(ctx, x, y, W, H, R)
  ctx.clip()
  const cell = images.cell.get(c.rarity ?? 0)
  if (cell) ctx.drawImage(cell, x, y, W, H)

  // The portrait in the top square, else initials.
  const portrait = images.portrait.get(c.key)
  if (portrait) drawCover(ctx, portrait, x, y, W, W)
  else {
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    ctx.font = font(500, 22 * CQW, family)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(initials(c.name), x + W / 2, y + W / 2)
  }

  // The cream strip with "Lv. 90", and the rounded notch above its right end.
  const strip = 20.5 * CQW
  ctx.fillStyle = CREAM
  ctx.fillRect(x, y + H - strip, W, strip)
  const notch = 19 * CQW
  const nx = x + W - notch
  const ny = y + H - 20.4 * CQW - notch
  ctx.beginPath()
  ctx.moveTo(nx + notch, ny)
  ctx.lineTo(nx + notch, ny + notch)
  ctx.lineTo(nx, ny + notch)
  ctx.arc(nx, ny, notch, Math.PI / 2, 0, true)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#4a5366'
  ctx.font = font(700, 15.5 * CQW, family)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`Lv. ${c.level}`, x + W / 2, y + H - strip / 2 + 0.5)
  ctx.restore()

  // Element (the game's light icon) at the top left.
  const element = c.element ? images.element.get(c.element) : null
  if (element) {
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = CQW
    ctx.shadowOffsetY = 0.5 * CQW
    ctx.drawImage(element, x + 4 * CQW, y + 4 * CQW, 22 * CQW, 22 * CQW)
    ctx.restore()
  }

  // Constellation chip at the top right (gold at C6).
  const max = c.constellation >= 6
  const chipY = y + 4 * CQW
  const chipH = 17 * CQW
  chip(
    ctx,
    `C${c.constellation}`,
    {
      x: x + W - 4 * CQW,
      y: chipY,
      h: chipH,
      minW: 17 * CQW,
      padX: 2.5 * CQW,
      r: 3.5 * CQW,
      align: 'right',
    },
    max
      ? {
          fill: goldGradient(ctx, chipY, chipH),
          color: GOLD.text,
          font: font(600, 11.5 * CQW, family),
          shadow: ['rgba(80,50,0,0.45)', 4, 1],
        }
      : { fill: 'rgba(59,66,85,0.9)', color: '#ffffff', font: font(600, 11.5 * CQW, family) },
  )

  // Talents as the game shows them, centred above the strip.
  const th = 16 * CQW
  const ty = y + H - 23 * CQW - th
  ctx.font = font(700, 12 * CQW, family)
  const widths = talents.map((t) =>
    Math.max(23 * CQW, ctx.measureText(String(t.level)).width + 4 * CQW),
  )
  const gap = 2.5 * CQW
  let tx = x + (W - (widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, talents.length - 1))) / 2
  talents.forEach((t, i) => {
    chip(
      ctx,
      String(t.level),
      { x: tx, y: ty, h: th, minW: widths[i]!, padX: 2 * CQW, r: 3.5 * CQW, align: 'left' },
      t.crowned
        ? {
            fill: goldGradient(ctx, ty, th),
            color: GOLD.text,
            font: font(700, 12 * CQW, family),
            shadow: ['rgba(80,50,0,0.45)', 4, 1],
          }
        : {
            fill: 'rgba(30,36,51,0.85)',
            color: t.from ? BOOST : t.low ? LOW : '#ffffff',
            font: font(700, 12 * CQW, family),
            shadow: ['rgba(0,0,0,0.35)', 1.5 * CQW, 0.5 * CQW],
            ...(t.silver ? { ring: [SILVER, 1.5 * CQW] as [string, number] } : {}),
          },
    )
    tx += widths[i]! + gap
  })
}

/** The drawn card as a PNG, encoded off the page's thread (lib/card-canvas). */
export function rosterPng(drawn: DrawnRoster): Promise<Blob> {
  return canvasPng(drawn.canvas)
}
