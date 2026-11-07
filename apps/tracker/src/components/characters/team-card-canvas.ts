/**
 * The team card drawn on a canvas, for its PNG and its preview: a header
 * (the team's name, the owner, the capture date) over one 1824×446 row per
 * character, each a condensed build card: its namecard and splash, name,
 * level and friendship, constellations, talents; the weapon and the stat
 * panel; the five pieces side by side over a card of the sets with the
 * build's RV / CV. Behind it all, blurred, the city painting of the region
 * most members are from (teamRegion), showing through the rows. Same palette
 * and parts as the build card (card-paint); geometry in team-card.
 */

import { bonusSets, buildRv, weaponLines } from '@/data/character-build'
import type { BuildPanel, TalentLevel } from '@/data/character-build'
import { SLOT_LABELS, type CharacterView } from '@/data/characters'
import { t } from '@/i18n'
import {
  artifactIcon,
  artifactSetIcon,
  characterBanner,
  characterIcon,
  characterSplash,
  elementIconLight,
  giCdnArt,
  regionBackground,
  weaponIcon,
} from '@/lib/assets'
import {
  CARD_CORNER,
  CardImages,
  Painter,
  cardFonts,
  linearGradient,
  parseInsetRing,
  parseShadows,
  roundCorners,
  type CardProgress,
} from '@/lib/card-canvas'
import { cvTier, rvTier } from '@/lib/crit-tiers'
import { formatDate } from '@/lib/format'
import { emblemBox } from '@/lib/item-art'
import { levelCap } from '@/lib/level'
import { formatStatShort, formatStatValue } from '@/utils/artifact-stats'
import {
  BAND_SHADE,
  CardPaint,
  ROLL_TIER,
  STAR_SHADOW,
  goldChip,
  parseFilterShadow,
  withAlpha,
} from './card-paint'
import { CONSTELLATION_MAX_STYLE, isMaxConstellation, refinementStyle } from './max-badges'
import {
  CARD_THEMES,
  EMBLEM_URL,
  RARITY_GRADIENT,
  SPLASH_BOX_SCALE,
  SPLASH_FULL,
  elementGlow,
  qualityArt,
  splashPlace,
  type CardOwner,
  type CardTheme,
} from './share-card'
import { cardPieces, ownerParts, type CardPiece } from './share-card-model'
import {
  ROW_COLUMNS,
  ROW_COLUMN_GAP,
  ROW_PAD,
  ROW_SETS,
  ROW_SPLASH_SCALE,
  ROW_WEAPON,
  TEAM_CARD_WIDTH,
  TEAM_HEADER,
  TEAM_PAD_X,
  TEAM_PAD_Y,
  TEAM_ROW,
  teamCardHeight,
  teamNameFit,
  teamRegion,
  teamRowTop,
} from './team-card'
import { constellationIcons, talentIcons } from './talent-icons'

/** One row's character, as the build card has it. */
export interface TeamMember {
  character: CharacterView
  panel: BuildPanel | null
  /** As the game shows them (C3/C5 boosts). */
  talents: readonly TalentLevel[]
  /** The bars under the level and friendship (share-card-model expShare). */
  levelBar: number | null
  friendshipBar: number | null
}

export interface TeamDrawing {
  members: readonly TeamMember[]
  /** The saved team's name; null leaves the header to the owner. */
  teamName: string | null
  theme: CardTheme
  owner: CardOwner
  /** When the capture was taken (epoch ms). */
  takenAt: number | null
  /** The Crown of Insight's icon ('' while the planner data loads). */
  crown: string
}

export interface DrawnTeam {
  canvas: HTMLCanvasElement
  /** Images that couldn't be loaded (drawn without them). */
  missing: number
}

// ------------------------------------------------------------------ layout (px)

const ROW_X = TEAM_PAD_X
const ROW_W = TEAM_CARD_WIDTH - 2 * TEAM_PAD_X
const INNER_H = TEAM_ROW - 2 * ROW_PAD
const WHO_X = ROW_X + ROW_PAD
const MID_X = WHO_X + ROW_COLUMNS.who + ROW_COLUMN_GAP
const PIECES_X = MID_X + ROW_COLUMNS.middle + ROW_COLUMN_GAP
const PIECE_GAP = 8
const PIECE_W = (ROW_COLUMNS.pieces - 4 * PIECE_GAP) / 5
const PIECE_H = INNER_H - 12 - ROW_SETS
const BAND_H = 104
const BAND_ICON = 72
/** A substat's roll bars: each this wide, this far apart, this tall at the top tier. */
const BAR_W = 4
const BAR_PITCH = 6
const BAR_H = 20
/** The city painting's filter, and the veil of the card's ground over it, per theme. */
const CITY_FILTER = {
  dark: { blur: 1.5, saturate: 1.05, brightness: 0.8 },
  light: { blur: 1.5, saturate: 1.05, brightness: 1.02 },
} as const
const CITY_VEIL = { dark: 0.25, light: 0.18 } as const
/** Where a row's middle falls on the painting (its share of the height): about the horizon. */
const CITY_HORIZON = 0.55
/**
 * The plate under the header's text, in the theme's chip colour: opaque enough
 * that the text reads over the painting's brightest sky (and darkest rock).
 */
const HEADER_PLATE = { dark: 'rgba(15,23,42,0.78)', light: 'rgba(255,255,255,0.88)' } as const
const PLATE_X = 22
const WEAPON_TILE = 88
const CONSTELLATION = 46
const TALENT = 66

/** The name's size in a row: 48px, smaller for long names ("Sangonomiya Kokomi" fits at 32). */
function rowNameSize(name: string): number {
  return name.length <= 11 ? 48 : name.length <= 14 ? 40 : name.length <= 18 ? 32 : 28
}

function splashUrl(key: string): string {
  return SPLASH_FULL[key] ? giCdnArt(`FullWish_${key}`) : characterSplash(key)
}

/** Every image a row draws. */
function rowImages(member: TeamMember, crown: string): string[] {
  const c = member.character
  const glyphs = talentIcons(c.key)
  return [
    characterBanner(c.key),
    splashUrl(c.key),
    c.element ? elementIconLight(c.element) : '',
    crown,
    ...constellationIcons(c.key),
    glyphs.auto,
    glyphs.skill,
    glyphs.burst,
    ...(c.weapon
      ? [qualityArt(c.weapon.rarity), weaponIcon(c.weapon.key, c.weapon.ascension)]
      : []),
    ...cardPieces(c).flatMap(({ piece }) =>
      piece ? [qualityArt(piece.rarity), artifactIcon(piece.setKey, piece.slotKey)] : [],
    ),
    ...bonusSets(c.sets).map(({ set }) => artifactSetIcon(set.setKey)),
    ...(member.panel?.rows.flatMap((row) =>
      row.damage && row.damage !== 'physical' ? [elementIconLight(row.damage)] : [],
    ) ?? []),
  ]
}

// ------------------------------------------------------------------ drawing

/** The card at `scale` device pixels per CSS pixel (1: the PNG). */
export async function drawTeamCard(
  input: TeamDrawing,
  scale = 1,
  progress?: CardProgress,
): Promise<DrawnTeam> {
  const city = regionBackground(teamRegion(input.members.map((m) => m.character.key)))
  const urls = [EMBLEM_URL, city, ...input.members.flatMap((m) => rowImages(m, input.crown))]
  const [images, fonts] = await Promise.all([
    CardImages.load(urls, progress),
    cardFonts([400, 500, 600, 700]),
  ])
  // A splash that failed: the portrait shows in its place.
  const fallbacks = input.members
    .map((m) => m.character)
    .filter((c) => !images.get(splashUrl(c.key)))
  const portraits = fallbacks.length
    ? await CardImages.load(fallbacks.flatMap((c) => [characterIcon(c.key), qualityArt(c.rarity)]))
    : null

  const height = teamCardHeight(input.members.length)
  const p = new Painter(TEAM_CARD_WIDTH, height, scale)
  try {
    const card = new TeamPainter(p, input, images, fonts.tabular, portraits)
    card.ground(height, city)
    card.header()
    input.members.forEach((member, index) => card.row(member, teamRowTop(index)))
    roundCorners(p.canvas, CARD_CORNER, scale)
    return { canvas: p.canvas, missing: images.missing + (portraits?.missing ?? 0) }
  } finally {
    p.done()
    images.close()
    portraits?.close()
  }
}

class TeamPainter extends CardPaint {
  constructor(
    p: Painter,
    private readonly input: TeamDrawing,
    images: CardImages,
    family: string,
    private readonly portraits: CardImages | null,
  ) {
    super(p, input.theme, images, family)
  }

  /** The city painting, when it loaded (else each row keeps its namecard). */
  private city: ImageBitmap | null = null

  /**
   * The card's ground: the city painting across the card's width, whole (a
   * taller card continues with it mirrored, like a reflection), softened a
   * little under a light veil of the theme's ground.
   */
  ground(height: number, city: string) {
    const { p, ctx } = this
    const ground = this.v('--card-ground')
    ctx.fillStyle = ground
    ctx.fillRect(0, 0, TEAM_CARD_WIDTH, height)
    const painting = this.images.get(city)
    if (!painting) return
    this.city = painting
    // A little larger than the card on every side, so the softening has no edge.
    const w = TEAM_CARD_WIDTH + 16
    const h = (w * painting.height) / painting.width
    const tall = height + 16
    // The copies are laid edge to edge on one canvas first and softened as one
    // picture: softened one by one, each copy's edge faded into the ground and
    // left a line across a taller card where they met (the user, 2026-11-07).
    // Each copy reaches 1px into the next, which is drawn over it, so no
    // half-covered pixel row shows the ground either.
    const strip = document.createElement('canvas')
    strip.width = Math.round(w * p.scale)
    strip.height = Math.round(tall * p.scale)
    const sctx = strip.getContext('2d')!
    sctx.scale(strip.width / w, strip.height / tall)
    sctx.imageSmoothingQuality = 'high'
    for (let k = 0; k * h < tall; k++) {
      sctx.save()
      sctx.translate(0, k * h + (k % 2 ? h : 0))
      if (k % 2) sctx.scale(1, -1)
      // Flipped, y −1 lands 1px below the copy's foot: both kinds reach down into the next.
      if (k % 2) sctx.drawImage(painting, 0, -1, w, h + 1)
      else sctx.drawImage(painting, 0, 0, w, h + 1)
      sctx.restore()
    }
    p.filtered(CITY_FILTER[this.cardTheme], () => ctx.drawImage(strip, -8, -8, w, tall))
    strip.width = strip.height = 0
    ctx.fillStyle = withAlpha(ground, CITY_VEIL[this.cardTheme])
    ctx.fillRect(0, 0, TEAM_CARD_WIDTH, height)
  }

  // -------------------------------------------------- header

  /**
   * The team's name at the left, the owner and the capture date at the right,
   * each on a plate of the theme's chip colour so it reads over the city.
   */
  header() {
    const top = TEAM_PAD_Y
    const right = TEAM_CARD_WIDTH - TEAM_PAD_X
    const text = this.v('--card-text')
    const secondary = this.v('--card-secondary')
    const owner = ownerParts(this.input.owner)
    const date = this.input.takenAt ? formatDate(this.input.takenAt) : null
    const dateText = [date, 'teyvat.me'].filter(Boolean).join('  ·  ')

    // Right plate: a 32px owner line over a 26px date line (or the date alone).
    const dot = '  ·  '
    const ownerW = owner.reduce(
      (sum, part, i) =>
        sum +
        this.textWidth(part, 24, i === 0 && this.input.owner.name ? 600 : 400) +
        (i ? this.textWidth(dot, 24, 400) : 0),
      0,
    )
    const dateW = this.textWidth(dateText, 18, 400)
    const blockW = Math.max(ownerW, dateW) + 2 * PLATE_X
    this.plate(right - blockW, top, blockW, TEAM_HEADER)
    const blockTop = top + (TEAM_HEADER - (owner.length ? 32 + 26 : 26)) / 2
    const textRight = right - PLATE_X
    if (owner.length) {
      let x = textRight - ownerW
      owner.forEach((part, i) => {
        if (i) x += this.line(dot, x, blockTop, 24, 400, secondary, { lineHeight: 32 })
        x += this.line(part, x, blockTop, 24, i === 0 && this.input.owner.name ? 600 : 400, text, {
          lineHeight: 32,
        })
      })
    }
    this.line(dateText, textRight, blockTop + (owner.length ? 32 : 0), 18, 400, secondary, {
      align: 'right',
      lineHeight: 26,
    })

    const name = this.input.teamName?.trim()
    if (!name) return
    this.p.letterSpaced(-0.5, () => {
      const fit = teamNameFit(
        this.textWidth(name, 52, 700),
        right - TEAM_PAD_X - blockW - 24 - 2 * 28,
      )
      this.plate(TEAM_PAD_X, top, fit.width + 2 * 28, TEAM_HEADER)
      this.line(name, TEAM_PAD_X + 28, top + (TEAM_HEADER - 64) / 2, 52, 700, text, {
        lineHeight: 64,
        max: fit.max,
      })
    })
  }

  /** A header plate: the theme's chip colour, its hairline. */
  private plate(x: number, y: number, w: number, h: number) {
    const r = 20
    this.p.fill(x, y, w, h, r, HEADER_PLATE[this.cardTheme])
    const ring = parseInsetRing(this.v('--card-chip-ring'))
    if (ring) this.p.insetRing(x, y, w, h, r, ring.width, ring.color)
  }

  // -------------------------------------------------- one row

  row(member: TeamMember, top: number) {
    const c = member.character
    this.background(c, top)
    this.who(member, top + ROW_PAD)
    this.weapon(c, top + ROW_PAD)
    this.stats(member.panel, top + ROW_PAD + ROW_WEAPON + 12)
    const pieces = cardPieces(c)
    pieces.forEach((piece, index) =>
      this.piece(piece, PIECES_X + index * (PIECE_W + PIECE_GAP), top + ROW_PAD),
    )
    this.sets(c, top + ROW_PAD + PIECE_H + 12)
    this.backdropCopy = null
  }

  /**
   * The row's ground: the city behind the card (else its namecard, blurred),
   * the scrim, the element's glow, the splash: the character stands in the
   * city, as in the game's Party Setup.
   */
  private background(c: CharacterView, top: number) {
    const { p, ctx } = this
    const k = ROW_SPLASH_SCALE
    p.clipped(ROW_X, top, ROW_W, TEAM_ROW, 26, () => {
      // The city's horizon band across the row: the character stands in it.
      if (this.city) {
        const w = ROW_W + 16
        const h = (w * this.city.height) / this.city.width
        p.filtered(CITY_FILTER[this.cardTheme], () =>
          ctx.drawImage(this.city!, ROW_X - 8, top + TEAM_ROW / 2 - CITY_HORIZON * h, w, h),
        )
      }
      const namecard = this.city ? null : this.images.get(characterBanner(c.key))
      if (namecard) {
        const filter = /blur\(([\d.]+)px\) saturate\(([\d.]+)\) brightness\(([\d.]+)\)/.exec(
          this.v('--card-namecard-filter'),
        )
        p.filtered(
          {
            blur: Number(filter?.[1] ?? 10),
            saturate: Number(filter?.[2] ?? 1),
            brightness: Number(filter?.[3] ?? 1),
          },
          () => p.cover(namecard, ROW_X - 40, top - 30, ROW_W + 80, TEAM_ROW + 60),
        )
      }
      this.gradients(this.v('--card-scrim'), top)
      if (c.element) this.glowAt(c, top)

      // The build card's splash, scaled from the card's corner to the row's.
      const place = splashPlace(c.key)
      const left = ROW_X + place.left * k + 12
      const boxTop = top + place.top * k
      const splash = this.images.get(splashUrl(c.key))
      const shadow = parseFilterShadow(this.v('--card-splash-shadow'))
      if (splash) {
        const full = SPLASH_FULL[c.key]
        p.dropShadow({ ...shadow, y: shadow.y * k, blur: shadow.blur * k }, () => {
          if (full) {
            const s = SPLASH_BOX_SCALE * k
            p.image(
              splash,
              left + full.x * s,
              boxTop + full.y * s,
              full.width * full.scale * s,
              full.height * full.scale * s,
            )
          } else p.contain(splash, left, boxTop, 2200 * k, 1100 * k)
        })
      } else if (this.portraits) {
        const x = WHO_X + (ROW_COLUMNS.who - CONSTELLATION - 120) / 2
        const y = top + (TEAM_ROW - 120) / 2
        p.clipped(x, y, 120, 120, 16, () => {
          const gradient = RARITY_GRADIENT[c.rarity ?? 0]
          const fill = gradient && linearGradient(ctx, gradient, x, y, 120, 120)
          if (fill) p.fill(x, y, 120, 120, 0, fill)
          p.image(this.portraits!.get(qualityArt(c.rarity)), x, y, 120, 120)
          p.image(this.portraits!.get(characterIcon(c.key)), x, y, 120, 120)
        })
      }
      if (!this.city) this.gradients(this.v('--card-vignette'), top)
    })
    this.backdropCopy = p.snapshot()
  }

  /** CSS `linear-gradient(…)` layers over the row (scrim, vignette), the last first. */
  private gradients(css: string, top: number) {
    for (const layer of css.split(/,\s*(?=linear-gradient)/).reverse()) {
      const fill = linearGradient(this.ctx, layer, ROW_X, top, ROW_W, TEAM_ROW)
      if (!fill) continue
      this.ctx.fillStyle = fill
      this.ctx.fillRect(ROW_X, top, ROW_W, TEAM_ROW)
    }
  }

  /** The build card's element glow, scaled to the row like the splash. */
  private glowAt(c: CharacterView, top: number) {
    const ctx = this.ctx
    const m = /rgba\((\d+,\d+,\d+),([\d.]+)\)/.exec(elementGlow(c.element!, this.cardTheme))
    if (!m) return
    const [rgb, core] = [m[1]!, Number(m[2])]
    const k = ROW_SPLASH_SCALE
    const r = 620 * k
    ctx.save()
    ctx.translate(ROW_X + 340 * k + 12, top + 560 * k)
    ctx.scale(1, 760 / 620)
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
    g.addColorStop(0, `rgba(${rgb},${core})`)
    g.addColorStop(0.45, `rgba(${rgb},0.1)`)
    g.addColorStop(0.75, `rgba(${rgb},0)`)
    ctx.fillStyle = g
    ctx.fillRect(-r, -r, 2 * r, 2 * r)
    ctx.restore()
  }

  // -------------------------------------------------- who

  private who(member: TeamMember, top: number) {
    const { p } = this
    const c = member.character
    const x0 = WHO_X
    const hero = this.v('--card-hero')
    const size = rowNameSize(c.name)
    const rowH = Math.max(c.element ? 44 : 0, size * 1.1, 34)
    let x = x0

    // The game's list icon, flat (a drop shadow read as a dark halo).
    if (c.element) {
      const icon = this.images.get(elementIconLight(c.element))
      const iy = top + (rowH - 44) / 2
      if (icon) p.contain(icon, x, iy, 44, 44)
      else this.elementGlyph(c.element, x, iy, 44)
      x += 44 + 14
    }

    // The C chip's width first: the name gives way to it (and to the constellations).
    // The name is the dark card's white with its shadow on either card: dark
    // text with a white glow looked smudged over the city.
    const chipText = `C${c.constellation}`
    const chipW = this.textWidth(chipText, 19, 700) + 20
    let nameW = 0
    p.letterSpaced(-0.5, () => {
      p.font(700, size, this.family)
      const nameMax = x0 + ROW_COLUMNS.who - CONSTELLATION - 16 - x - 12 - chipW
      const name = p.ellipsize(c.name, nameMax)
      nameW = p.measure(name)
      p.text(name, x, p.baseline(top + (rowH - size) / 2, size), CARD_THEMES.dark['--card-hero']!, {
        shadows: parseShadows(CARD_THEMES.dark['--card-hero-shadow']!),
      })
    })
    x += nameW + 12
    const chipTop = top + (rowH - 34) / 2
    if (isMaxConstellation(c.constellation)) {
      p.boxShadow(x, chipTop, chipW, 34, 17, { x: 0, y: 1, blur: 4, color: 'rgba(80,50,0,0.45)' })
      p.fill(x, chipTop, chipW, 34, 17, goldChip(this.ctx, chipTop, 34))
      this.line(chipText, x + 10, chipTop + 2.5, 19, 700, CONSTELLATION_MAX_STYLE.color)
    } else {
      this.glass(x, chipTop, chipW, 34, 17, 'chip')
      this.line(chipText, x + 10, chipTop + 2.5, 19, 700, hero)
    }

    // Level and friendship with their EXP bars, on a backing.
    const boxTop = top + rowH + 8
    this.levelBox(member, x0, boxTop)
    if (c.rarity) this.stars(c.rarity, x0 + 2, boxTop + 50 + 8, 24, 4, STAR_SHADOW)

    // Constellations down the column's right edge.
    const gap = 12
    constellationIcons(c.key).forEach((src, index) =>
      this.disc(
        x0 + ROW_COLUMNS.who - CONSTELLATION,
        top + index * (CONSTELLATION + gap),
        CONSTELLATION,
        src,
        null,
        index >= c.constellation,
        `C${index + 1}`,
        c.element,
      ),
    )

    this.talents(member, x0, top + INNER_H - (TALENT + 6 + 30))
  }

  /** "Lv. 90/90 · Friendship 10" at 22px, each half over its bar (as wide as its widest). */
  private levelBox(member: TeamMember, x0: number, top: number) {
    const { p } = this
    const c = member.character
    const size = 22
    const color = this.v('--card-hero')
    const width = (parts: { text: string; weight: number }[]) =>
      parts.reduce((sum, part) => sum + this.textWidth(part.text, size, part.weight), 0)
    const level = [
      { text: 'Lv. ', weight: 400, alpha: 0.85 },
      { text: String(c.level), weight: 700 },
      { text: `/${levelCap(c.ascension, c.level)}`, weight: 500, alpha: 0.7 },
    ]
    const friendship =
      c.friendship === null
        ? null
        : [
            { text: `${t('game.friendship')} `, weight: 400, alpha: 0.85 },
            { text: String(c.friendship), weight: 700 },
          ]
    const slot = Math.max(
      width(level),
      width([
        { text: 'Lv. ', weight: 400 },
        { text: '100', weight: 700 },
        { text: '/100', weight: 500 },
      ]),
      friendship ? width(friendship) : 0,
    )
    const dotW = this.textWidth('·', size, 400)
    const inner = slot + (friendship ? 16 + dotW + 16 + slot : 0)
    this.glass(x0, top, 14 + inner + 14, 50, 16, 'chip')
    const lineTop = top + 8
    const draw = (parts: typeof level, from: number, share: number | null, barColor: string) => {
      let x = from
      for (const part of parts) {
        x += this.line(part.text, x, lineTop, size, part.weight, color, {
          alpha: part.alpha,
          lineHeight: 26,
        })
      }
      const by = lineTop + 26 + 2
      p.fill(from, by, slot, 4, 2, withAlpha(color, 0.2))
      p.clipped(from, by, slot, 4, 2, () =>
        p.fill(from, by, (slot * (share ?? 0)) / 100, 4, 2, barColor),
      )
    }
    draw(level, x0 + 14, member.levelBar, '#818cf8')
    if (friendship) {
      const dx = x0 + 14 + slot + 16
      this.line('·', dx, lineTop, size, 400, color, { alpha: 0.5, lineHeight: 26 })
      draw(friendship, dx + dotW + 16, member.friendshipBar, '#f472b6')
    }
  }

  private talents(member: TeamMember, x0: number, top: number) {
    const { p } = this
    const c = member.character
    const glyphs = talentIcons(c.key)
    let x = x0
    for (const talent of member.talents) {
      const crown = talent.crowned && this.images.get(this.input.crown)
      const levelText = String(talent.level)
      const textW = this.textWidth(levelText, 20, 700)
      const pillW = 12 + (crown ? 22 + 4 : 0) + textW + 12
      const w = Math.max(TALENT, pillW)
      this.disc(x + (w - TALENT) / 2, top, TALENT, glyphs[talent.key], 54, false, '', c.element)
      const px = x + (w - pillW) / 2
      const py = top + TALENT + 6
      p.fill(px, py, pillW, 30, 15, this.v('--card-pill'))
      if (talent.crowned) p.insetRing(px, py, pillW, 30, 15, 2, this.tokens['talent-crown'])
      else if (talent.silver) p.insetRing(px, py, pillW, 30, 15, 2, this.tokens['talent-silver'])
      let tx = px + 12
      if (crown) {
        p.image(crown, px + 7, py + 4, 22, 22)
        tx = px + 7 + 22 + 4
      }
      const color = talent.crowned
        ? this.tokens['talent-crown']
        : talent.from
          ? this.tokens['talent-boost']
          : this.v(talent.low ? '--card-muted' : '--card-text')
      this.line(levelText, tx, py, 20, 700, color, { lineHeight: 30 })
      x += w + 18
    }
  }

  // -------------------------------------------------- weapon and stats

  private weapon(c: CharacterView, top: number) {
    const { p } = this
    const x = MID_X
    const w = ROW_COLUMNS.middle
    this.glass(x, top, w, ROW_WEAPON, 18, 'panel')
    const muted = this.v('--card-muted')
    const text = this.v('--card-text')
    if (!c.weapon) {
      this.line(
        t('characters.gap.noWeapon'),
        x + w / 2,
        top + (ROW_WEAPON - 30) / 2,
        20,
        400,
        muted,
        {
          align: 'center',
        },
      )
      return
    }
    const weapon = c.weapon
    const tx = x + 14
    const ty = top + (ROW_WEAPON - WEAPON_TILE) / 2
    this.itemArt(
      tx,
      ty,
      WEAPON_TILE,
      WEAPON_TILE,
      12,
      weapon.rarity,
      emblemBox(WEAPON_TILE, WEAPON_TILE / 2),
      0.48,
    )
    p.clipped(tx, ty, WEAPON_TILE, WEAPON_TILE, 12, () =>
      p.image(
        this.images.get(weaponIcon(weapon.key, weapon.ascension)),
        tx,
        ty,
        WEAPON_TILE,
        WEAPON_TILE,
      ),
    )

    const cx = tx + WEAPON_TILE + 16
    const maxW = x + w - 16 - cx
    const lines = weaponLines(weapon)
    const colH = 30 + 4 + 30 + (lines ? 4 + 26 : 0)
    let y = top + (ROW_WEAPON - colH) / 2
    this.line(weapon.name, cx, y, 23, 600, text, { lineHeight: 30, max: maxW })
    y += 30 + 4
    let lx = cx
    lx += this.line('Lv. ', lx, y, 18, 400, muted, { lineHeight: 30 })
    lx += this.line(String(weapon.level), lx, y, 18, 600, text, { lineHeight: 30 })
    lx += this.line(`/${levelCap(weapon.ascension, weapon.level)}`, lx, y, 18, 400, muted, {
      lineHeight: 30,
    })
    lx += 10
    const refine = refinementStyle(weapon.refinement)
    const rText = `R${weapon.refinement}`
    const rW = this.textWidth(rText, 17, 700) + 16
    p.fill(lx, y + 1, rW, 28, 7, refine.background)
    this.line(rText, lx + 8, y + 1, 17, 700, refine.color, { lineHeight: 28 })
    lx += rW + 10
    if (weapon.rarity) this.stars(weapon.rarity, lx, y + 7, 16, 2, STAR_SHADOW)
    y += 30 + 4
    if (lines) {
      let sx = cx
      for (const stat of [lines.atk, lines.sub]) {
        if (!stat) continue
        const label = `${formatStatShort(stat.key === 'baseAtk' ? 'atk' : stat.key)} `
        if (sx + this.textWidth(label + stat.text, 18, 700) > x + w - 16) break
        sx += this.line(label, sx, y, 18, 400, muted, { lineHeight: 26 })
        sx += this.line(stat.text, sx, y, 18, 700, text, { lineHeight: 26 }) + 16
      }
    }
  }

  /** The panel's rows, totals only (the build card adds the base and the bonus). */
  private stats(panel: BuildPanel | null, top: number) {
    const { p } = this
    const x = MID_X
    const w = ROW_COLUMNS.middle
    const h = INNER_H - ROW_WEAPON - 12
    this.glass(x, top, w, h, 18, 'panel')
    if (!panel) {
      this.line(
        t('characters.stats.none'),
        x + w / 2,
        top + (h - 30) / 2,
        20,
        400,
        this.v('--card-muted'),
        {
          align: 'center',
        },
      )
      return
    }
    const rows = panel.rows
    const share = (h - 12 - (rows.length - 1)) / rows.length
    const left = x + 20
    const right = x + w - 20
    let y = top + 6
    rows.forEach((row, index) => {
      const mid = y + share / 2
      const color = row.damage ? this.damageColor(row.damage) : null
      const valueW = Math.max(90, this.textWidth(row.text, 23, 700))
      this.line(row.text, right, mid - 15, 23, 700, color ?? this.v('--card-text'), {
        align: 'right',
        lineHeight: 30,
      })
      let lx = left
      let labelMax = right - valueW - 10 - left
      if (row.damage && row.damage !== 'physical') {
        const icon = this.images.get(elementIconLight(row.damage))
        if (icon) p.contain(icon, lx, mid - 11, 22, 22)
        else this.elementGlyph(row.damage, lx, mid - 11, 22)
        lx += 22 + 8
        labelMax -= 30
      }
      this.line(row.label, lx, mid - 14, 19, 400, color ?? this.v('--card-secondary'), {
        lineHeight: 28,
        max: labelMax,
      })
      if (index < rows.length - 1) {
        this.ctx.fillStyle = this.v('--card-rule')
        this.ctx.fillRect(left, y + share, right - left, 1)
        y += 1
      }
      y += share
    })
  }

  // -------------------------------------------------- pieces

  /** A piece's tile: the band (art, icon, CV, stars, level), the main stat, four substats. */
  private piece(slot: CardPiece, x: number, top: number) {
    const { p } = this
    const w = PIECE_W
    this.glass(x, top, w, PIECE_H, 16, 'panel')
    const piece = slot.piece
    if (!piece) {
      this.line(
        SLOT_LABELS[slot.slot],
        x + w / 2,
        top + (PIECE_H - 30) / 2,
        18,
        400,
        this.v('--card-muted'),
        {
          align: 'center',
          lineHeight: 30,
        },
      )
      return
    }

    p.clipped(x, top, w, PIECE_H, 16, () => {
      const iconX = x + w - 6 - BAND_ICON
      this.itemArt(
        x,
        top,
        w,
        BAND_H,
        0,
        piece.rarity,
        emblemBox(BAND_H, w - 6 - BAND_ICON / 2),
        0.7,
      )
      p.dropShadow({ x: 0, y: 3, blur: 8, color: 'rgba(70,36,6,0.35)' }, () =>
        p.image(
          this.images.get(artifactIcon(piece.setKey, piece.slotKey)),
          iconX,
          top + (BAND_H - BAND_ICON) / 2 - 4,
          BAND_ICON,
          BAND_ICON,
        ),
      )
      // CV at the top left, stars at the foot, the level at the foot's right.
      const cv = `CV ${piece.cv.toFixed(1)}`
      const cvW = this.textWidth(cv, 15, 600) + 12
      p.fill(x + 8, top + 8, cvW, 23, 6, BAND_SHADE)
      const tone = slot.cv
      this.line(cv, x + 14, top + 8, 15, 600, tone?.color ?? '#ffffff', {
        lineHeight: 23,
        shadows: this.glow(tone, tone?.color ?? '#ffffff'),
      })
      this.stars(piece.rarity, x + 8, top + BAND_H - 8 - 13, 13, 1, {
        x: 0,
        y: 1,
        blur: 1,
        color: 'rgba(70,36,6,0.5)',
      })
      const level = `+${piece.level}`
      const levelW = this.textWidth(level, 15, 700) + 12
      const lx = x + w - 6 - levelW
      const ly = top + BAND_H - 6 - 22
      p.fill(lx, ly, levelW, 22, 6, 'rgba(30,16,4,0.55)')
      this.line(level, lx + 6, ly, 15, 700, '#ffffff', { lineHeight: 22 })
    })

    // The main stat and its value.
    const left = x + 8
    const right = x + w - 8
    let y = top + BAND_H + 8
    this.line(formatStatShort(piece.mainStatKey), left, y, 16, 400, this.v('--card-muted'), {
      lineHeight: 22,
      max: right - left,
    })
    y += 22
    const value =
      piece.mainStatValue === null ? '—' : formatStatValue(piece.mainStatKey, piece.mainStatValue)
    this.line(value, left, y, 28, 700, this.v('--card-text'), { lineHeight: 34 })
    y += 34 + 4

    // Four substats: name, value, roll bars (the slot as wide as this piece's most-rolled).
    const bottom = top + PIECE_H - 8
    const lineH = (bottom - y) / 4
    const most = Math.max(1, ...slot.lines.map((line) => (line.inactive ? 0 : line.rolls.length)))
    const barsW = most * BAR_PITCH - (BAR_PITCH - BAR_W)
    for (let n = 0; n < 4; n++) {
      const line = slot.lines[n]
      if (!line) continue
      const ly = y + n * lineH + (lineH - 24) / 2
      this.ctx.save()
      if (line.inactive) this.ctx.globalAlpha = 0.45
      const barsX = right - barsW
      const text = formatStatValue(line.key, line.value)
      const valueW = this.textWidth(text, 16, 600)
      this.line(text, barsX - 6, ly, 16, 600, this.v('--card-text'), {
        align: 'right',
        lineHeight: 24,
      })
      this.line(formatStatShort(line.key), left, ly, 14, 400, this.v('--card-secondary'), {
        lineHeight: 24,
        max: barsX - 6 - valueW - 6 - left,
      })
      if (!line.inactive) {
        line.rolls.forEach((roll, k) => {
          const bh = Math.round(BAR_H * ROLL_TIER[roll.quality]!)
          p.fill(
            barsX + k * BAR_PITCH,
            ly + (24 - BAR_H) / 2 + BAR_H - bh,
            BAR_W,
            bh,
            1.5,
            this.v(`--card-roll-${roll.quality}`),
          )
        })
      }
      this.ctx.restore()
    }
  }

  /**
   * The card under the pieces: the sets worn for a bonus, one line each
   * (one set larger), and the build's RV and CV as large figures at the right.
   */
  private sets(c: CharacterView, top: number) {
    const { p } = this
    const x = PIECES_X
    const w = ROW_COLUMNS.pieces
    const h = ROW_SETS
    this.glass(x, top, w, h, 16, 'panel')
    const left = x + 18
    const right = x + w - 22
    const muted = this.v('--card-muted')
    if (!c.artifactCount) {
      this.line(t('characters.detail.noArtifacts'), left, top + (h - 28) / 2, 20, 400, muted, {
        lineHeight: 28,
      })
      return
    }

    // Right: "Build" over "RV 1,036%  CV 214.6", in the build card's tiers.
    const rv = buildRv(c.artifacts)
    const rvText = `${rv}%`
    const cvText = c.cv.toFixed(1)
    const rvTone = rv > 0 ? this.tier(rvTier(rv, 'build')) : { color: this.v('--card-text') }
    const cvTone = c.cv > 0 ? this.tier(cvTier(c.cv, 'build')) : { color: this.v('--card-text') }
    const figures = 22 + 2 + 38
    const capTop = top + (h - figures) / 2
    const valueTop = capTop + 22 + 2
    const labelW = (text: string) => this.textWidth(text, 18, 500)
    const blockW =
      labelW('RV ') +
      this.textWidth(rvText, 30, 700) +
      24 +
      labelW('CV ') +
      this.textWidth(cvText, 30, 700)
    let rx = right - blockW
    const end = rx - 28
    this.line(t('characters.detail.build'), rx, capTop, 15, 500, muted, { lineHeight: 22 })
    const label = (text: string) => {
      rx += this.line(text, rx, valueTop + 6, 18, 500, muted, { lineHeight: 30 })
    }
    label('RV ')
    rx += this.line(rvText, rx, valueTop, 30, 700, rvTone.color, {
      shadows: rvTone.shadows,
      lineHeight: 38,
    })
    rx += 24
    label('CV ')
    this.line(cvText, rx, valueTop, 30, 700, cvTone.color, {
      shadows: cvTone.shadows,
      lineHeight: 38,
    })

    // Left: each set's icon, its piece count and its name; a lone set larger.
    const sets = bonusSets(c.sets)
    const one = sets.length === 1
    const icon = one ? 48 : 32
    const size = one ? 24 : 19
    const lineH = one ? 48 : 34
    const gap = 6
    let y = top + (h - (sets.length * lineH + (sets.length - 1) * gap)) / 2
    for (const { set, pieces } of sets) {
      let sx = left
      p.image(this.images.get(artifactSetIcon(set.setKey)), sx, y + (lineH - icon) / 2, icon, icon)
      sx += icon + 10
      const count = String(pieces)
      const chipH = one ? 30 : 26
      const chipW = Math.max(chipH, this.textWidth(count, size - 2, 700) + 14)
      const chipTop = y + (lineH - chipH) / 2
      p.fill(sx, chipTop, chipW, chipH, 7, this.v('--card-set-on-bg'))
      this.line(count, sx + chipW / 2, chipTop, size - 2, 700, this.v('--card-set-on'), {
        align: 'center',
        lineHeight: chipH,
      })
      sx += chipW + 10
      this.line(
        set.name,
        sx,
        y + (lineH - size * 1.3) / 2,
        size,
        one ? 600 : 500,
        this.v('--card-text'),
        {
          lineHeight: size * 1.3,
          max: Math.max(0, end - sx),
        },
      )
      y += lineH + gap
    }
  }
}
