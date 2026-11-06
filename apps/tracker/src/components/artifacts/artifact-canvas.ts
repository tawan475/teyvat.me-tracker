/**
 * The artifact share picture drawn straight onto a canvas: the grid's card
 * (ArtifactCard) alone on transparency, ARTIFACT_SHARE_WIDTH CSS px wide with
 * a 2px margin for its hairline, at ARTIFACT_SHARE_SCALE (1080 px wide). The
 * same picture the DOM card is in the share theme, from the same row; its
 * layout below is ArtifactCard's at a 16px rem (the old export's frame): a
 * change to one is a change to the other. See lib/card-canvas for why a canvas.
 */

import type { CardTheme } from '@/components/characters/share-card'
import type { ArtifactRow } from '@/data/artifacts'
import { mainStatValue } from '@/data/characters'
import { t } from '@/i18n'
import { artifactIcon, characterIcon, characterSideIcon } from '@/lib/assets'
import {
  CardImages,
  Painter,
  cardFonts,
  iconPath,
  linearGradient,
  themeTokens,
  type Shadow,
} from '@/lib/card-canvas'
import { cvTier, isCritCirclet, rvTier } from '@/lib/crit-tiers'
import { EMBLEM, EMBLEM_URL, RARITY_GRADIENT, emblemBox, qualityArt } from '@/lib/item-art'
import {
  formatSlotFullName,
  formatStatName,
  formatStatShort,
  formatStatValue,
} from '@/utils/artifact-stats'
import {
  ARTIFACT_SHARE_MARGIN as MARGIN,
  ARTIFACT_SHARE_WIDTH,
  BAND_HEIGHT,
  BAND_ICON,
  BAND_ICON_RIGHT,
  artifactCardHeight,
} from './card-style'
import { artifactPieceName } from './piece-name'

export interface DrawnArtifact {
  canvas: HTMLCanvasElement
  /** Images that couldn't be loaded (drawn without them). */
  missing: number
}

/** The card inside the picture's margin. */
const W = ARTIFACT_SHARE_WIDTH - 2 * MARGIN
const RADIUS = 12
const ROW = 24
const BAND_INK = '#f1f5f9'
const BAND_SHADOW: Shadow = { x: 0, y: 1, blur: 2, color: 'rgba(70,36,6,0.55)' }
const BAND_CHIP = 'rgba(30,16,4,0.55)'
/** Tailwind's shadow-sm under the card. */
const CARD_SHADOWS: (Shadow & { spread: number })[] = [
  { x: 0, y: 1, blur: 3, spread: 0, color: 'rgb(0 0 0 / 0.1)' },
  { x: 0, y: 1, blur: 2, spread: -1, color: 'rgb(0 0 0 / 0.1)' },
]
/** A roll's bar: its fill (ROLL_QUALITY_FILL) and colour token (ROLL_QUALITY_BG). */
const ROLL_FILL: Record<number, number> = { 1: 0.45, 2: 0.65, 3: 0.82, 4: 1 }
const ROLL_TOKEN: Record<number, Token> = {
  1: 'rarity-1',
  2: 'rarity-3',
  3: 'rarity-4',
  4: 'rarity-5',
}

// lucide's icons (24×24): the marks at the set line's end or in the Equipped bar.
const LOCK =
  'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4'
const SPARKLE =
  'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z'
const FLASK =
  'M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2M6.453 15h11.094M8.5 2h7'
const STAR =
  'M12 1.8l2.95 6.6 7.2.75-5.4 4.85 1.53 7.08L12 17.4l-6.28 3.68 1.53-7.08-5.4-4.85 7.2-.75z'

const TOKENS = [
  'artifact-body',
  'artifact-ink',
  'artifact-muted',
  'artifact-set',
  'artifact-foot',
  'artifact-track',
  'artifact-ring',
  'rarity-1',
  'rarity-3',
  'rarity-4',
  'rarity-5',
  'game-star',
  'game-star-edge',
] as const
type Token = (typeof TOKENS)[number]
/** The chips' row is `data-theme="dark"`: its tier colours and secondary text are the dark ones. */
const CHIP_TOKENS = [
  'cv-0',
  'cv-1',
  'cv-2',
  'cv-3',
  'cv-4',
  'cv-5',
  'cv-6',
  'text-secondary',
] as const

/** The picture at `scale` device pixels per CSS pixel. */
export async function drawArtifactCard(
  row: ArtifactRow,
  theme: CardTheme,
  scale: number,
): Promise<DrawnArtifact> {
  const a = row.artifact
  const side = a.location ? characterSideIcon(a.location) : ''
  const portrait = a.location ? characterIcon(a.location) : ''
  const [images, fonts] = await Promise.all([
    CardImages.load([qualityArt(a.rarity), EMBLEM_URL, artifactIcon(a.setKey, a.slotKey), side]),
    cardFonts([400, 600, 700]),
  ])
  // The round portrait where the side one fails (ArtifactCard's @error).
  const fallback = portrait && !images.get(side) ? await CardImages.load([portrait]) : null
  const height = artifactCardHeight(row)
  const p = new Painter(ARTIFACT_SHARE_WIDTH, height, scale)
  try {
    const tokens = themeTokens(theme, TOKENS)
    const chips = themeTokens('dark', CHIP_TOKENS)
    const { plain, tabular } = fonts
    const ctx = p.ctx
    const x0 = MARGIN
    const y0 = MARGIN
    const h = height - 2 * MARGIN
    /** Text in a line box: weight, size, the box's top and height. */
    const line = (
      text: string,
      x: number,
      top: number,
      size: number,
      lineHeight: number,
      weight: number,
      color: string,
      options: {
        family?: string
        max?: number
        align?: CanvasTextAlign
        alpha?: number
        shadows?: readonly Shadow[]
      } = {},
    ) => {
      p.font(weight, size, options.family ?? plain)
      const shown = options.max !== undefined ? p.ellipsize(text, options.max) : text
      return p.text(shown, x, p.baseline(top, lineHeight), color, options)
    }
    const width = (text: string, size: number, weight: number, family = plain) => {
      p.font(weight, size, family)
      return p.measure(text)
    }

    // The card: shadow-sm, the ring outside its edge, the body.
    for (const shadow of CARD_SHADOWS) p.boxShadow(x0, y0, W, h, RADIUS, shadow, shadow.spread)
    p.boxShadow(x0, y0, W, h, RADIUS, { x: 0, y: 0, blur: 0, color: tokens['artifact-ring'] }, 1)
    p.fill(x0, y0, W, h, RADIUS, tokens['artifact-body'])

    p.clipped(x0, y0, W, h, RADIUS, () => {
      // The art band: the rarity's header art, the emblem at 60%, the piece.
      const gradient = RARITY_GRADIENT[a.rarity]
      ctx.fillStyle =
        (gradient && linearGradient(ctx, gradient, x0, y0, W, BAND_HEIGHT)) || '#72778b'
      ctx.fillRect(x0, y0, W, BAND_HEIGHT)
      if (qualityArt(a.rarity)) p.image(images.get(qualityArt(a.rarity)), x0, y0, W, BAND_HEIGHT)
      const emblem = emblemBox(BAND_HEIGHT, 0)
      const emblemRight =
        BAND_ICON_RIGHT + BAND_ICON / 2 - (EMBLEM.width - EMBLEM.knotX) * emblem.scale
      ctx.save()
      ctx.globalAlpha = 0.6
      p.image(
        images.get(EMBLEM_URL),
        x0 + W - emblemRight - emblem.width,
        y0 + emblem.top,
        emblem.width,
        emblem.height,
      )
      ctx.restore()
      p.dropShadow({ x: 0, y: 3, blur: 6, color: 'rgba(70,36,6,0.35)' }, () =>
        p.image(
          images.get(artifactIcon(a.setKey, a.slotKey)),
          x0 + W - BAND_ICON_RIGHT - BAND_ICON,
          y0 + (BAND_HEIGHT - BAND_ICON) / 2,
          BAND_ICON,
          BAND_ICON,
        ),
      )

      // Name; slot and stars; main stat; +20, CV, RV and the CV it should reach.
      const left = x0 + 12
      const inner = W - 24
      let y = y0 + (BAND_HEIGHT - 90.75) / 2
      const name = artifactPieceName(a.setKey, a.slotKey) ?? row.setName
      line(name, left, y, 15, 18.75, 600, BAND_INK, { max: inner, shadows: [BAND_SHADOW] })
      y += 18.75 + 2
      const slot = formatSlotFullName(a.slotKey)
      const starsW = a.rarity * 11
      const slotShown = (() => {
        p.font(400, 12, plain)
        return p.ellipsize(slot, inner - 8 - starsW)
      })()
      const slotW = line(slotShown, left, y, 12, 16, 400, BAND_INK, {
        alpha: 0.9,
        shadows: [BAND_SHADOW],
      })
      stars(p, a.rarity, left + slotW + 8, y + 2.5, 11, tokens)
      y += 16 + 2
      // The main stat and its value share a baseline (items-baseline): 28px tall.
      const value = mainStatValue(a)
      const valueText = value === null ? '—' : formatStatValue(a.mainStatKey, value)
      const valueW = width(valueText, 20, 700, tabular)
      p.font(700, 15, plain)
      const statText = p.ellipsize(formatStatName(a.mainStatKey), inner - 80 - 8 - valueW)
      const statW = line(statText, left, y + 7, 15, 18.75, 700, BAND_INK, {
        shadows: [BAND_SHADOW],
      })
      line(valueText, left + statW + 8, y, 20, 28, 700, BAND_INK, {
        family: tabular,
        shadows: [BAND_SHADOW],
      })
      y += 28 + 2 + 2
      let cx = left
      const chip = (parts: { text: string; color: string; family: string; alpha?: number }[]) => {
        const w = parts.reduce((sum, part) => sum + width(part.text, 12, 600, part.family), 0) + 12
        p.fill(cx, y, w, 20, 4, BAND_CHIP)
        let tx = cx + 6
        for (const part of parts) {
          tx += line(part.text, tx, y, 12, 20, 600, part.color, {
            family: part.family,
            alpha: part.alpha,
          })
        }
        cx += w + 6
      }
      const plainTier = a.rarity < 5
      const tierColor = (tier: number) =>
        plainTier ? chips['text-secondary'] : chips[`cv-${tier}` as (typeof CHIP_TOKENS)[number]]
      chip([{ text: `+${a.level}`, color: BAND_INK, family: tabular }])
      chip([
        { text: 'CV ', color: BAND_INK, family: plain, alpha: 0.7 },
        {
          text: row.cv.toFixed(1),
          color: tierColor(cvTier(row.cv, 'artifact', isCritCirclet(a.slotKey, a.mainStatKey))),
          family: tabular,
        },
      ])
      chip([
        { text: 'RV ', color: BAND_INK, family: plain, alpha: 0.7 },
        { text: `${row.rv}%`, color: tierColor(rvTier(row.rv)), family: tabular },
      ])
      const potential = row.potential
      if (potential.left > 0 && potential.expectedCv > row.cv) {
        chip([
          {
            text: `→ ~${Math.round(potential.expectedCv)}`,
            color: BAND_INK,
            family: tabular,
            alpha: 0.8,
          },
        ])
      }
    })

    // The substats: the value beside its roll bars (the slot fits the most-rolled one).
    const most = Math.max(1, ...row.rolls.map((r) => r.length))
    const barsW = most * 6 + (most - 1) * 2
    const left = x0 + 12
    const right = x0 + W - 10
    let y = y0 + BAND_HEIGHT + 6
    const rows = [
      ...a.substats.map((s, i) => ({ ...s, rolls: row.rolls[i] ?? [], inactive: false })),
      ...(a.unactivatedSubstats ?? []).map((s) => ({ ...s, rolls: [], inactive: true })),
    ]
    for (const sub of rows) {
      ctx.save()
      if (sub.inactive) ctx.globalAlpha = 0.55
      const ink = tokens['artifact-ink']
      const dotW = line('·', left, y, 14, ROW, 600, tokens['artifact-muted'])
      const barsX = right - barsW
      const valueText = formatStatValue(sub.key, sub.value)
      const valueW = width(valueText, 14, 600, tabular)
      line(valueText, barsX - 8, y, 14, ROW, 600, ink, { family: tabular, align: 'right' })
      const labelX = left + dotW + 8
      line(formatStatShort(sub.key), labelX, y, 14, ROW, 600, ink, {
        max: barsX - 8 - valueW - 8 - labelX,
      })
      if (sub.inactive) {
        // A dashed box where the bars go: the line opens at +4.
        dashedBox(ctx, barsX, y + 4, barsW, 16, ink)
      } else {
        sub.rolls.forEach((roll, k) => {
          const bx = barsX + k * 8
          p.fill(bx, y + 4, 6, 16, 2, tokens['artifact-track'])
          const fill = 16 * ROLL_FILL[roll.quality]!
          p.clipped(bx, y + 4, 6, 16, 2, () =>
            p.fill(bx, y + 20 - fill, 6, fill, 2, tokens[ROLL_TOKEN[roll.quality]!]),
          )
        })
      }
      ctx.restore()
      y += ROW
    }
    y += 6

    // The set, in the game's green; the marks end its line when no one wears the piece.
    const marks = [
      ...(a.elixirCrafted ? (['flask'] as const) : []),
      ...(a.astralMark ? (['astral'] as const) : []),
      ...(a.lock ? (['lock'] as const) : []),
    ]
    const marksW = marks.length ? marks.length * 16 + (marks.length - 1) * 6 : 0
    const drawMarks = (endX: number, top: number) => {
      let mx = endX - marksW
      for (const mark of marks) {
        if (mark === 'flask') {
          iconPath(ctx, FLASK, mx, top, 16, { stroke: tokens['artifact-muted'], lineWidth: 2 })
        } else if (mark === 'astral') {
          iconPath(ctx, SPARKLE, mx, top, 16, { fill: '#e0a417', stroke: '#e0a417', lineWidth: 2 })
        } else {
          iconPath(ctx, LOCK, mx, top, 16, { stroke: '#e8704a', lineWidth: 2.6 })
        }
        mx += 16 + 6
      }
    }
    const setRight = x0 + W - 12
    const ownMarks = !row.ownerName && marks.length
    line(row.setName, left, y, 14, 20, 600, tokens['artifact-set'], {
      max: setRight - left - (ownMarks ? marksW + 8 : 0),
    })
    if (ownMarks) drawMarks(setRight, y + 2)
    y += 20 + 6

    // The game's "Equipped" bar, the wearer's side portrait poking out of it.
    if (row.ownerName) {
      p.clipped(x0, y0, W, h, RADIUS, () => p.fill(x0, y, W, 36, 0, tokens['artifact-foot']))
      const wearer = images.get(side) ?? fallback?.get(portrait) ?? null
      if (wearer) {
        // object-contain, object-bottom in 52×52 at the bar's foot.
        const k = Math.min(52 / wearer.width, 52 / wearer.height)
        const ww = wearer.width * k
        const wh = wearer.height * k
        p.dropShadow({ x: 0, y: 1, blur: 2, color: 'rgba(0,0,0,0.25)' }, () =>
          p.image(wearer, x0 + 6 + (52 - ww) / 2, y + 36 - wh, ww, wh),
        )
      }
      const endX = x0 + W - 12
      line(
        t('artifacts.card.equipped', { name: row.ownerName }),
        x0 + 60,
        y + 8,
        14,
        20,
        600,
        tokens['artifact-ink'],
        {
          max: endX - (marks.length ? marksW + 8 : 0) - (x0 + 60),
        },
      )
      if (marks.length) drawMarks(endX, y + 10)
    }

    return { canvas: p.canvas, missing: images.missing + (fallback?.missing ?? 0) }
  } finally {
    p.done()
    images.close()
    fallback?.close()
  }
}

/** GameStars (gap 0): gold stars, their drop shadow under the row. */
function stars(
  p: Painter,
  count: number,
  x: number,
  y: number,
  size: number,
  tokens: Record<Token, string>,
) {
  const boxes = Array.from({ length: count }, (_, i) => p.snap(x + i * size, y, size, size))
  p.layerShadow(
    { x, y, w: count * size, h: size },
    { x: 0, y: 1, blur: 2, color: 'rgba(80,50,0,0.5)' },
    (ctx) => {
      for (const [sx, sy, side] of boxes) {
        iconPath(ctx, STAR, sx, sy, side, {
          fill: tokens['game-star'],
          stroke: tokens['game-star-edge'],
          lineWidth: 0.8,
        })
      }
    },
  )
}

/**
 * A 1px dashed border with 2px corners as Chrome draws one: each side on its
 * own between the corners, dashes and gaps alike spread so the side starts
 * and ends with a dash (a short side gets one 3px dash, centred).
 */
function dashedBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  const RADIUS = 2
  ctx.fillStyle = color
  const side = (length: number, put: (at: number, size: number) => void) => {
    const span = length - 2 * RADIUS
    const n = Math.round((span + 2.4) / 4.8)
    if (n <= 1) {
      const size = Math.min(3, length - 2)
      put((length - size) / 2, size)
      return
    }
    const dash = span / (2 * n - 1)
    for (let i = 0; i < n; i++) put(RADIUS + 2 * i * dash, dash)
  }
  side(w, (at, size) => {
    ctx.fillRect(x + at, y, size, 1)
    ctx.fillRect(x + at, y + h - 1, size, 1)
  })
  side(h, (at, size) => {
    ctx.fillRect(x, y + at, 1, size)
    ctx.fillRect(x + w - 1, y + at, 1, size)
  })
}
