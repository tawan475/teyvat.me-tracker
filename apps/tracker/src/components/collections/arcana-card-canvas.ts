/**
 * The Lunar Arcana share card drawn on a canvas, for its PNG and preview
 * (arcana-card.ts says where everything goes). A card held shows its art; a
 * missing one shows its own art very dark and blurred with its numeral
 * over it as the lock (the user's pick, 2026-11-18), so held or missing
 * differs in lightness, sharpness and a mark, never by hue alone. Copies
 * beyond the first are a "×2" badge.
 */

import { t } from '@/i18n'
import { giCdnArt } from '@/lib/assets'
import {
  CARD_CORNER,
  CardImages,
  Painter,
  cardFonts,
  roundCorners,
  type CardProgress,
} from '@/lib/card-canvas'
import { formatDate, formatNumber } from '@/lib/format'
import type { CardTheme } from '../characters/share-card'
import { ARCANA_CARD, arcanaGrid, type ArcanaLayout } from './arcana-card'

export interface ArcanaCardEntry {
  /** The card art's name (`UI_RoleCombat_Tarot_06`). */
  icon: string
  numeral: string
  title: string
  count: number
}

export interface ArcanaDrawing {
  layout: ArcanaLayout
  theme: CardTheme
  cards: readonly ArcanaCardEntry[]
  held: number
  spare: number
  /** "Imaginarium Theater · Lunar Mode". */
  subtitle: string
  /** The foot's owner parts; null ones are left out (the share options). */
  owner: { name: string | null; uid: string | null; ar: number | null }
  /** When the capture the counts come from was taken (ms). */
  takenAt: number
}

export interface DrawnArcana {
  canvas: HTMLCanvasElement
  missing: number
}

interface Palette {
  stops: readonly [string, string, string]
  text: string
  sub: string
  numeral: string
  count: string
  track: string
  lock: string
  missingTitle: string
  brand: string
}

const PALETTE: Record<CardTheme, Palette> = {
  dark: {
    stops: ['#2e1f5e', '#1a1440', '#0b1120'],
    text: '#f8fafc',
    sub: '#cbd5e1',
    numeral: '#a5b4fc',
    count: '#fcd34d',
    track: 'rgba(248,250,252,0.18)',
    lock: '#f1f5f9',
    missingTitle: '#94a3b8',
    brand: '#f59e0b',
  },
  light: {
    stops: ['#ede9fe', '#e0e7ff', '#f8fafc'],
    text: '#0f172a',
    sub: '#475569',
    numeral: '#4f46e5',
    count: '#b45309',
    track: 'rgba(15,23,42,0.12)',
    lock: '#f8fafc',
    missingTitle: '#64748b',
    brand: '#b45309',
  },
}

/** The card art's own corner, as a share of its width (the picture is a rounded card). */
const CARD_RADIUS = 0.075

export async function drawArcanaCard(
  input: ArcanaDrawing,
  scale = 1,
  progress?: CardProgress,
): Promise<DrawnArcana> {
  const spec = ARCANA_CARD[input.layout]
  const [images, fonts] = await Promise.all([
    CardImages.load(
      input.cards.map((c) => giCdnArt(c.icon)),
      progress,
    ),
    cardFonts([400, 500, 600, 700]),
  ])
  const p = new Painter(spec.width, spec.height, scale)
  const family = fonts.tabular
  const c = PALETTE[input.theme]
  const ctx = p.ctx
  const line = (
    text: string,
    x: number,
    top: number,
    size: number,
    weight: number,
    color: string,
    options: { align?: CanvasTextAlign; max?: number; lineHeight?: number } = {},
  ) => {
    p.font(weight, size, family)
    const shown = options.max !== undefined ? p.ellipsize(text, options.max) : text
    return p.text(shown, x, p.baseline(top, options.lineHeight ?? size * 1.2), color, options)
  }
  const width = (text: string, size: number, weight: number) => {
    p.font(weight, size, family)
    return p.measure(text)
  }

  try {
    // The ground: a moonlit glow from the top's middle.
    // CSS `radial-gradient(120% 90% at 50% 0%, …)` (70% tall on the tall card).
    const rx = spec.width * 1.2
    const ry = spec.height * (input.layout === 'wide' ? 0.9 : 0.7)
    ctx.fillStyle = c.stops[2]
    ctx.fillRect(0, 0, spec.width, spec.height)
    ctx.save()
    ctx.translate(spec.width / 2, 0)
    ctx.scale(1, ry / rx)
    const ground = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
    ground.addColorStop(0, c.stops[0])
    ground.addColorStop(0.45, c.stops[1])
    ground.addColorStop(1, c.stops[2])
    ctx.fillStyle = ground
    ctx.fillRect(-spec.width / 2, 0, spec.width, rx)
    ctx.restore()

    const { side, top } = spec.pad
    const right = spec.width - side
    const total = input.cards.length
    const held = formatNumber(input.held)
    const spare = t('collections.arcana.spareN', { n: formatNumber(input.spare) })
    const ratio = total ? input.held / total : 0

    if (input.layout === 'wide') {
      // Title left, the count and its bar right.
      line(t('collections.tabs.lunarArcana'), side, top + 18, 66, 600, c.text, {
        lineHeight: 70,
        max: spec.width - side * 2 - 480,
      })
      line(input.subtitle, side, top + 94, 26, 400, c.sub, {
        lineHeight: 32,
        max: spec.width - side * 2 - 480,
      })
      const of = `/ ${formatNumber(total)}`
      const ofW = width(of, 34, 400)
      const heldW = width(held, 76, 600)
      line(of, right, top + 48, 34, 400, c.sub, { align: 'right', lineHeight: 44 })
      line(held, right - ofW - 12, top + 22, 76, 600, c.count, { align: 'right', lineHeight: 80 })
      if (input.spare > 0)
        line(spare, right - ofW - heldW - 32, top + 54, 24, 400, c.sub, {
          align: 'right',
          lineHeight: 32,
        })
      bar(right - 440, top + 112, 440)
    } else {
      line(t('collections.tabs.lunarArcana'), side, top, 60, 600, c.text, {
        lineHeight: 64,
        max: spec.width - side * 2 - 260,
      })
      line(input.subtitle, side, top + 70, 24, 400, c.sub, {
        lineHeight: 30,
        max: spec.width - side * 2 - 260,
      })
      const of = `/ ${formatNumber(total)}`
      const ofW = width(of, 32, 400)
      line(of, right, top + 30, 32, 400, c.sub, { align: 'right', lineHeight: 40 })
      line(held, right - ofW - 10, top + 4, 72, 600, c.count, { align: 'right', lineHeight: 76 })
      const spareW = input.spare > 0 ? width(spare, 22, 400) + 20 : 0
      bar(side, top + 118, spec.width - side * 2 - spareW)
      if (input.spare > 0)
        line(spare, right, top + 108, 22, 400, c.sub, { align: 'right', lineHeight: 32 })
    }

    /**
     * A missing card on its own layer: the art blurred (where canvas filters
     * work; Safari before 18 draws it sharp), darkened by a veil, cut to the
     * art's own outline.
     */
    function shaded(
      image: ImageBitmap | null,
      box: { x: number; y: number; w: number; h: number },
    ) {
      if (!image) {
        p.fill(box.x, box.y, box.w, box.h, box.w * 0.075, '#0b1020')
        return
      }
      const k = p.canvas.width / spec.width
      const layer = document.createElement('canvas')
      layer.width = Math.round(box.w * k)
      layer.height = Math.round(box.h * k)
      const lctx = layer.getContext('2d')!
      lctx.imageSmoothingQuality = 'high'
      const fit = Math.min(layer.width / image.width, layer.height / image.height)
      const dw = image.width * fit
      const dh = image.height * fit
      const dx = (layer.width - dw) / 2
      const dy = (layer.height - dh) / 2
      lctx.fillStyle = '#0b1020'
      lctx.fillRect(0, 0, layer.width, layer.height)
      lctx.filter = `blur(${3.5 * k}px) saturate(0.7)`
      const grow = 3 * k
      lctx.drawImage(image, dx - grow, dy - grow, dw + grow * 2, dh + grow * 2)
      lctx.filter = 'none'
      // A light veil, then a mild darkening that radiates from the middle (where the numeral sits).
      lctx.fillStyle = 'rgba(8,12,28,0.4)'
      lctx.fillRect(0, 0, layer.width, layer.height)
      const cx = layer.width / 2
      const cy = layer.height / 2
      lctx.save()
      lctx.translate(cx, cy)
      lctx.scale(1, layer.height / layer.width)
      const glow = lctx.createRadialGradient(0, 0, 0, 0, 0, layer.width * 0.62)
      glow.addColorStop(0, 'rgba(4,6,16,0.5)')
      glow.addColorStop(1, 'rgba(4,6,16,0)')
      lctx.fillStyle = glow
      lctx.fillRect(-cx, -cx, layer.width, layer.width)
      lctx.restore()
      lctx.globalCompositeOperation = 'destination-in'
      lctx.drawImage(image, dx, dy, dw, dh)
      p.ctx.drawImage(layer, box.x, box.y, box.w, box.h)
      layer.width = layer.height = 0
    }

    function bar(x: number, y: number, w: number) {
      p.fill(x, y, w, 12, 6, c.track)
      if (ratio > 0) p.fill(x, y, Math.max(12, w * ratio), 12, 6, c.count)
    }

    // The cards.
    const boxes = arcanaGrid(input.layout, total)
    input.cards.forEach((card, i) => {
      const box = boxes[i]!
      const image = images.get(giCdnArt(card.icon))
      const radius = box.w * CARD_RADIUS
      const missing = card.count === 0
      if (missing) {
        // Its own art, very dark and blurred, kept to the card's outline (the art as a mask).
        shaded(image, box)
        const size = Math.round(box.w * (card.numeral.length > 3 ? 0.27 : 0.34))
        p.font(700, size, family)
        p.letterSpaced(2, () =>
          p.text(card.numeral, box.x + box.w / 2, box.y + box.h / 2 + size * 0.36, c.lock, {
            align: 'center',
            shadows: [{ x: 0, y: 2, blur: 8, color: 'rgba(0,0,0,0.7)' }],
          }),
        )
      } else {
        p.contain(image, box.x, box.y, box.w, box.h)
      }
      if (card.count > 1) {
        const text = `×${formatNumber(card.count)}`
        const tw = width(text, 20, 700)
        const w = tw + 24
        const x = box.x + box.w + 12 - w
        const y = box.y + 4
        p.fill(x - 2, y - 2, w + 4, 36, 18, '#f8fafc')
        p.fill(x, y, w, 32, 16, '#0f172a')
        line(text, x + w / 2, y, 20, 700, '#f8fafc', { align: 'center', lineHeight: 32 })
      }
      const below = box.y + box.h + spec.lineGap
      line(card.numeral, box.x + box.w / 2, below, spec.numeral, 500, c.numeral, {
        align: 'center',
        lineHeight: spec.numeral,
      })
      // A long title steps down a few px before it is cut.
      const room = box.w + spec.gap.x - 6
      let titleSize = spec.title
      while (titleSize > spec.title - 4 && width(card.title, titleSize, 500) > room) titleSize--
      line(
        card.title,
        box.x + box.w / 2,
        below + spec.numeral + spec.lineGap + (spec.title - titleSize) / 2,
        titleSize,
        500,
        missing ? c.missingTitle : c.text,
        { align: 'center', lineHeight: titleSize + 2, max: room },
      )
    })

    // The foot: owner left, the capture's date and teyvat.me right.
    const footTop = spec.height - spec.pad.bottom - spec.foot
    let x = side
    const owner = [
      input.owner.name ? { text: input.owner.name, weight: 600, color: c.text } : null,
      input.owner.ar
        ? { text: `${t('game.ar')} ${input.owner.ar}`, weight: 400, color: c.sub }
        : null,
      input.owner.uid ? { text: `UID ${input.owner.uid}`, weight: 400, color: c.sub } : null,
    ].filter((part) => part !== null)
    for (const part of owner) {
      x += line(part.text, x, footTop, 22, part.weight, part.color, { lineHeight: spec.foot }) + 18
    }
    const brandW = line('teyvat.me', right, footTop, 22, 600, c.text, {
      align: 'right',
      lineHeight: spec.foot,
    })
    const starW = line('✦ ', right - brandW, footTop, 22, 600, c.brand, {
      align: 'right',
      lineHeight: spec.foot,
    })
    line(formatDate(input.takenAt), right - brandW - starW - 18, footTop, 22, 400, c.sub, {
      align: 'right',
      lineHeight: spec.foot,
    })

    roundCorners(p.canvas, CARD_CORNER, scale)
    return { canvas: p.canvas, missing: images.missing }
  } finally {
    p.done()
    images.close()
  }
}
