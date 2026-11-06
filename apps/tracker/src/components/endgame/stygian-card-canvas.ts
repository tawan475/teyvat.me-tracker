/**
 * The Stygian Onslaught record card drawn on a canvas, for its PNG and its
 * preview (stygian-card.ts says what is on it and where). The ground is the
 * game's Stygian purple; panels are the share cards' glass (card-paint), in
 * the chosen card theme. Done or not is a mark and a struck time, never
 * the colour alone.
 */

import type { GiFigure, GiStygianRecord } from '@gdt/shared'
import { recordTotal } from '@/data/endgame-runs'
import { characterMeta } from '@/data/game-meta'
import { characterName } from '@/i18n/game-names'
import { t } from '@/i18n'
import { characterIcon, giCdnArt } from '@/lib/assets'
import { CARD_CORNER, CardImages, Painter, cardFonts, roundCorners } from '@/lib/card-canvas'
import { formatDate, formatNumber, formatSeconds } from '@/lib/format'
import { qualityCell } from '@/lib/item-art'
import { CardPaint, parseFilterShadow } from '../characters/card-paint'
import type { CardOwner, CardTheme } from '../characters/share-card'
import { ownerParts } from '../characters/share-card-model'
import {
  STYGIAN_CARD,
  fastestFight,
  seasonMonth,
  stygianCardLayout,
  stygianMedal,
} from './stygian-card'

export interface StygianBossArt {
  /** The boss's full name ("Name: Title"). */
  name: string
  /** Its art on the purple swirl, else its icon (a URL; '' none). */
  art: string
}

export interface StygianDrawing {
  record: GiStygianRecord
  seasonName: string
  /** The season's start, "YYYY-MM-DD hh:mm:ss" (its month on the card). */
  start: string
  difficultyName: string
  level: number
  /** Per fight, the boss of that slot on the record's difficulty. */
  bosses: readonly (StygianBossArt | null)[]
  /** The account's characters now (newest capture): level and constellation by key. */
  roster: ReadonlyMap<string, { level: number; constellation: number }>
  theme: CardTheme
  owner: CardOwner
}

export interface DrawnStygian {
  canvas: HTMLCanvasElement
  missing: number
}

/** The ground: the game's Stygian purple, a glow behind the rows. */
const GROUND = {
  dark: { base: '#140d26', glow: 'rgba(139,92,246,0.30)', warm: 'rgba(219,39,119,0.16)' },
  light: { base: '#f3eefb', glow: 'rgba(139,92,246,0.22)', warm: 'rgba(236,72,153,0.12)' },
} as const
/** The boss art's own ground, under its picture (the game's swirl is transparent at the edges). */
const ART_GROUND = ['#2a1748', '#120a24'] as const
const CREAM = '#e9e5dc'
const CREAM_INK = '#3f3a33'
const TILE = { w: 112, h: 138, gap: 14, strip: 26, r: 12 } as const
const FIGURE_H = 62

export async function drawStygianCard(input: StygianDrawing, scale = 1): Promise<DrawnStygian> {
  const layout = stygianCardLayout(input.record.fights.length)
  const keys = [
    ...new Set(
      input.record.fights.flatMap((f) => [...f.team, f.strike?.by ?? '', f.damage?.by ?? '']),
    ),
  ].filter(Boolean)
  const rarities = [...new Set(keys.map((key) => characterMeta(key)?.[0] ?? 4))]
  const urls = [
    giCdnArt(stygianMedal(input.record)),
    ...input.bosses.map((b) => b?.art ?? ''),
    ...keys.map((key) => characterIcon(key)),
    ...rarities.map((r) => qualityCell(r)),
  ].filter(Boolean)
  const [images, fonts] = await Promise.all([
    CardImages.load(urls),
    cardFonts([400, 600, 700, 800]),
  ])
  const p = new Painter(layout.width, layout.height, scale)
  try {
    const card = new StygianPainter(p, input, images, fonts.tabular)
    card.ground(layout.width, layout.height)
    card.header()
    card.side(layout.side)
    layout.rows.forEach((row, i) => card.fight(i, row))
    roundCorners(p.canvas, CARD_CORNER, scale)
    return { canvas: p.canvas, missing: images.missing }
  } finally {
    p.done()
    images.close()
  }
}

type Box = { x: number; y: number; w: number; h: number }

class StygianPainter extends CardPaint {
  private readonly fastest: number
  private readonly total: number | null

  constructor(
    p: Painter,
    private readonly input: StygianDrawing,
    images: CardImages,
    family: string,
  ) {
    super(p, input.theme, images, family)
    this.fastest = fastestFight(input.record)
    this.total = recordTotal(input.record)
  }

  private get hero() {
    return {
      color: this.v('--card-hero'),
      shadows: [parseFilterShadow(this.v('--card-hero-shadow'))],
    }
  }

  ground(width: number, height: number) {
    const { ctx, p } = this
    const g = GROUND[this.cardTheme]
    ctx.fillStyle = g.base
    ctx.fillRect(0, 0, width, height)
    const glow = (x: number, y: number, r: number, color: string) => {
      const radial = ctx.createRadialGradient(x, y, 0, x, y, r)
      radial.addColorStop(0, color)
      radial.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = radial
      ctx.fillRect(0, 0, width, height)
    }
    glow(width * 0.72, height * 0.18, 900, g.glow)
    glow(width * 0.12, height * 0.95, 700, g.warm)
    this.backdropCopy = p.snapshot()
  }

  /** The mode, the season's name; at the right the run kind, difficulty and month as pills. */
  header() {
    const { pad, headerTop, width } = STYGIAN_CARD
    this.line(t('endgame.modes.stygian'), pad, headerTop, 20, 700, this.v('--card-secondary'), {
      lineHeight: 26,
    })
    const hero = this.hero
    const pills = [
      this.input.record.coop ? t('endgame.captured.coop') : t('endgame.captured.solo'),
      this.input.level
        ? `${this.input.difficultyName} · ${t('endgame.level', { n: this.input.level })}`
        : this.input.difficultyName,
      seasonMonth(this.input.start),
    ].filter(Boolean)
    const widths = pills.map((text) => this.textWidth(text, 18, 700) + 32)
    let px = width - pad - widths.reduce((sum, w) => sum + w + 10, -10)
    const pillsLeft = px
    pills.forEach((text, i) => {
      const w = widths[i]!
      this.p.fill(px, headerTop + 38, w, 40, 20, this.v('--card-pill'))
      this.p.insetRing(px, headerTop + 38, w, 40, 20, 1, this.ring)
      this.line(
        text,
        px + 16,
        headerTop + 46,
        18,
        700,
        i === 0 ? this.v('--card-text') : this.v('--card-secondary'),
        {
          lineHeight: 24,
        },
      )
      px += w + 10
    })
    this.line(this.input.seasonName, pad, headerTop + 28, 44, 800, hero.color, {
      lineHeight: 54,
      shadows: hero.shadows,
      max: pillsLeft - pad - 24,
    })
  }

  private get ring() {
    return this.cardTheme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.12)'
  }

  /** The owner, the best record (medal, total), the battle synopsis, the date and the site. */
  side(box: Box) {
    const { x, y, w, h } = box
    this.glass(x, y, w, h, 24, 'panel')
    const inner = 28
    const cx = x + w / 2
    const text = this.v('--card-text')
    const muted = this.v('--card-muted')
    const secondary = this.v('--card-secondary')
    let cy = y + inner

    const owner = this.input.owner
    if (owner.name || owner.uid || owner.ar) {
      if (owner.name) {
        const [name] = ownerParts({ name: owner.name, uid: null, ar: null })
        this.line(name!, x + inner, cy, 28, 700, text, { lineHeight: 36, max: w - inner * 2 })
        cy += 38
      }
      const meta = ownerParts({ name: null, uid: owner.uid, ar: owner.ar })
      if (meta.length) {
        this.line(meta.join(' · '), x + inner, cy, 17, 400, muted, { lineHeight: 24 })
        cy += 26
      }
      cy += 14
      this.p.fill(x + inner, cy, w - inner * 2, 1, 0, this.v('--card-divider'))
      cy += 22
    }

    // The synopsis sits on the foot (above the date and the site); the best
    // record is centred in what is left above it.
    const fights = this.input.record.fights.length
    const footY = y + h - inner - 24
    const synopsisTop = footY - 26 - fights * 46
    const medalSize = 176
    const totalH = this.total !== null ? 84 : 56
    const bestH = 34 + medalSize + 6 + totalH
    const room = synopsisTop - 22 - cy
    cy += Math.max(0, (room - bestH) / 2)

    // The best record: the medal and the total time.
    this.line(t('endgame.share.bestRecord'), cx, cy, 20, 700, secondary, {
      lineHeight: 26,
      align: 'center',
    })
    cy += 34
    const medal = this.images.get(giCdnArt(stygianMedal(this.input.record)))
    if (medal) this.p.contain(medal, cx - medalSize / 2, cy, medalSize, medalSize)
    cy += medalSize + 6
    const hero = this.hero
    const totalText =
      this.total !== null
        ? formatSeconds(this.total)
        : t('endgame.captured.clearedOf', {
            n: this.input.record.fights.filter((f) => f.done).length,
            total: this.input.record.fights.length,
          })
    this.line(totalText, cx, cy, this.total !== null ? 64 : 36, 800, hero.color, {
      lineHeight: this.total !== null ? 76 : 48,
      align: 'center',
      shadows: hero.shadows,
    })
    this.p.fill(x + inner, synopsisTop - 22, w - inner * 2, 1, 0, this.v('--card-divider'))
    cy = synopsisTop

    // The battle synopsis: each fight's time, the fastest marked.
    this.input.record.fights.forEach((fight, i) => {
      const rowY = cy + i * 46
      this.line(t('endgame.share.battlefield', { n: i + 1 }), x + inner, rowY + 6, 20, 600, text, {
        lineHeight: 28,
        max: w - inner * 2 - 170,
      })
      const time = formatSeconds(fight.time)
      const right = x + w - inner
      this.line(time, right, rowY + 4, 24, 800, fight.done ? text : muted, {
        lineHeight: 32,
        align: 'right',
      })
      const timeW = this.textWidth(time, 24, 800)
      if (!fight.done) {
        this.p.fill(right - timeW - 2, rowY + 21, timeW + 4, 2, 1, muted)
      }
      if (i === this.fastest) {
        const label = t('endgame.share.fastest')
        const lw = this.textWidth(label, 15, 700) + 20
        const lx = right - timeW - 12 - lw
        this.p.fill(
          lx,
          rowY + 6,
          lw,
          28,
          14,
          this.cardTheme === 'dark' ? 'rgba(45,212,191,0.22)' : 'rgba(13,148,136,0.14)',
        )
        this.p.insetRing(
          lx,
          rowY + 6,
          lw,
          28,
          14,
          1,
          this.cardTheme === 'dark' ? 'rgba(94,234,212,0.55)' : 'rgba(13,148,136,0.45)',
        )
        this.line(
          label,
          lx + 10,
          rowY + 9,
          15,
          700,
          this.cardTheme === 'dark' ? '#99f6e4' : '#0f766e',
          { lineHeight: 22 },
        )
      }
    })

    // The foot: when the record was set, and the site.
    this.line(formatDate(this.input.record.at * 1000), x + inner, footY, 17, 400, muted, {
      lineHeight: 24,
    })
    this.line('teyvat.me', x + w - inner, footY, 17, 700, secondary, {
      lineHeight: 24,
      align: 'right',
    })
  }

  /** One battlefield: the boss's art and level, its name, the time, the team and the two figures. */
  fight(index: number, box: Box) {
    const fight = this.input.record.fights[index]
    if (!fight) return
    const { p, ctx } = this
    const { x, y, w, h } = box
    this.glass(x, y, w, h, 22, 'panel')
    const text = this.v('--card-text')
    const muted = this.v('--card-muted')
    const secondary = this.v('--card-secondary')

    // The boss: its art on the swirl, the level in a chip.
    const boss = this.input.bosses[index] ?? null
    const art = boss?.art ? this.images.get(boss.art) : null
    p.clipped(x, y, h, h, [22, 0, 0, 22], () => {
      const fill = ctx.createLinearGradient(x, y, x, y + h)
      fill.addColorStop(0, ART_GROUND[0])
      fill.addColorStop(1, ART_GROUND[1])
      ctx.fillStyle = fill
      ctx.fillRect(x, y, h, h)
      if (art) p.cover(art, x, y, h, h)
    })
    if (this.input.level) {
      const label = t('endgame.level', { n: this.input.level })
      const lw = this.textWidth(label, 18, 700) + 24
      p.fill(x + 14, y + h - 14 - 36, lw, 36, 18, 'rgba(8,6,18,0.72)')
      this.line(label, x + 14 + 12, y + h - 14 - 36 + 6, 18, 700, '#f8fafc', { lineHeight: 24 })
    }

    const x0 = x + h + 28
    const right = x + w - 28
    // The time at the right, with a done mark (a check, or the time struck through).
    const time = formatSeconds(fight.time)
    const timeW = this.textWidth(time, 44, 800)
    this.line(time, right, y + 18, 44, 800, fight.done ? text : muted, {
      lineHeight: 54,
      align: 'right',
    })
    if (fight.done)
      this.check(right - timeW - 34, y + 34, 24, this.cardTheme === 'dark' ? '#5eead4' : '#0f766e')
    else p.fill(right - timeW - 2, y + 45, timeW + 4, 3, 1, muted)
    this.line(t('endgame.share.battleTime'), right, y + 72, 16, 600, muted, {
      lineHeight: 22,
      align: 'right',
    })

    // Which battlefield, and the boss's name.
    const nameMax = right - x0 - timeW - 60
    this.line(t('endgame.share.battlefield', { n: index + 1 }), x0, y + 22, 16, 700, secondary, {
      lineHeight: 22,
      max: nameMax,
    })
    this.line(
      boss?.name || t('endgame.captured.fight', { n: index + 1 }),
      x0,
      y + 46,
      28,
      700,
      text,
      {
        lineHeight: 36,
        max: nameMax,
      },
    )

    // The team as bag cells, then the two figures.
    const tileY = y + h - 24 - TILE.h
    fight.team.slice(0, 4).forEach((key, i) => this.tile(key, x0 + i * (TILE.w + TILE.gap), tileY))
    const figuresX = x0 + 4 * TILE.w + 3 * TILE.gap + 32
    const figures = [
      { label: t('endgame.share.strike'), figure: fight.strike },
      { label: t('endgame.share.damage'), figure: fight.damage },
    ].filter((f): f is { label: string; figure: GiFigure } => !!f.figure)
    figures.forEach((f, i) =>
      this.figure(f.label, f.figure, figuresX, tileY + i * (FIGURE_H + 14), right - figuresX),
    )
  }

  /** A team member as the game's bag cell: portrait, constellation, level on the cream strip. */
  private tile(key: string, x: number, y: number) {
    const { p } = this
    const rarity = characterMeta(key)?.[0] ?? 4
    const now = this.input.roster.get(key)
    p.clipped(x, y, TILE.w, TILE.h, TILE.r, () => {
      const cell = this.images.get(qualityCell(rarity))
      if (cell) p.cover(cell, x, y, TILE.w, TILE.h)
      else p.fill(x, y, TILE.w, TILE.h, 0, rarity === 5 ? '#b7791f' : '#7c5ab8')
      const portrait = this.images.get(characterIcon(key))
      if (portrait) p.cover(portrait, x, y, TILE.w, TILE.w)
      p.fill(x, y + TILE.h - TILE.strip, TILE.w, TILE.strip, 0, CREAM)
    })
    if (now) {
      this.line(
        t('endgame.level', { n: now.level }),
        x + TILE.w / 2,
        y + TILE.h - TILE.strip + 2,
        16,
        700,
        CREAM_INK,
        {
          lineHeight: 22,
          align: 'center',
        },
      )
      const c = `C${now.constellation}`
      const cw = this.textWidth(c, 14, 800) + 14
      const gold = now.constellation === 6
      p.fill(x + 6, y + 6, cw, 24, 12, gold ? '#facc15' : 'rgba(8,6,18,0.72)')
      this.line(c, x + 6 + 7, y + 8, 14, 800, gold ? '#422006' : '#f8fafc', { lineHeight: 20 })
    }
    p.insetRing(x, y, TILE.w, TILE.h, TILE.r, 1, 'rgba(255,255,255,0.18)')
  }

  /** A figure: whose it was (a round portrait), the label, the value. */
  private figure(label: string, figure: GiFigure, x: number, y: number, w: number) {
    const { p } = this
    this.glass(x, y, w, FIGURE_H, 16, 'chip')
    let tx = x + 18
    if (figure.by) {
      const size = 44
      const portrait = this.images.get(characterIcon(figure.by))
      p.fill(x + 10, y + 9, size, size, size / 2, this.v('--card-pill'))
      if (portrait)
        p.clipped(x + 10, y + 9, size, size, size / 2, () =>
          p.cover(portrait, x + 10, y + 9, size, size),
        )
      p.insetRing(x + 10, y + 9, size, size, size / 2, 1, this.ring)
      tx = x + 10 + size + 14
    }
    const value = formatNumber(figure.value)
    const valueW = this.textWidth(value, 26, 800)
    this.line(value, x + w - 18, y + 14, 26, 800, this.v('--card-text'), {
      lineHeight: 34,
      align: 'right',
    })
    const byName = figure.by ? ` · ${characterName(figure.by)}` : ''
    this.line(`${label}${byName}`, tx, y + 19, 16, 600, this.v('--card-secondary'), {
      lineHeight: 24,
      max: x + w - 18 - valueW - 16 - tx,
    })
  }

  /** A check mark (the fight was done): drawn, so no font needs the glyph. */
  private check(x: number, y: number, size: number, color: string) {
    const { ctx } = this
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = size / 6
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(x + size * 0.15, y + size * 0.55)
    ctx.lineTo(x + size * 0.42, y + size * 0.8)
    ctx.lineTo(x + size * 0.88, y + size * 0.22)
    ctx.stroke()
    ctx.restore()
  }
}
