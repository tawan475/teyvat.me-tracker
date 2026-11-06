/**
 * The Stygian Onslaught record card drawn on a canvas, for its PNG and its
 * preview (stygian-card.ts says what is on it and where; design F). The
 * ground is the game's Stygian purple. Done or not is never the colour
 * alone: a fight not done has its time struck through. A co-op record
 * (Capture 1.17.20) puts every player's characters in the tiles, each with
 * the game's 1P-4P badge at its bottom-left, and the players in the foot
 * line between the date and the site (the user's design, 2026-11-07).
 */

import type { GiFigure, GiStygianRecord } from '@gdt/shared'
import { recordTotal } from '@/data/endgame-runs'
import { characterMeta } from '@/data/game-meta'
import { frameSize } from '@/data/profile-card'
import { coopBadge, fightMembers, type FightMember } from '@/data/stygian-coop'
import { t } from '@/i18n'
import { characterIcon, elementIcon, giCdnArt } from '@/lib/assets'
import {
  CARD_CORNER,
  CardImages,
  Painter,
  cardFonts,
  drawQualityCell,
  roundCorners,
} from '@/lib/card-canvas'
import { dateFormat, formatDate, formatNumber, formatSeconds } from '@/lib/format'
import { qualityCell } from '@/lib/item-art'
import { CardPaint, goldChip } from '../characters/card-paint'
import type { CardTheme } from '../characters/share-card'
import {
  COLUMN,
  MEDAL_PILL,
  PROFILE,
  SEASON_DIM,
  SEASON_FADE,
  STYGIAN_CARD,
  bagCell,
  columnFootH,
  fastestFight,
  seasonMonth,
  splitBossName,
  stygianColumns,
  stygianHeader,
  stygianMedal,
  wrapLines,
} from './stygian-card'

export interface StygianBossArt {
  /** The boss's full name ("Name: Title"). */
  name: string
  /** Its art on the purple swirl, else its icon (a URL; '' none). */
  art: string
}

/** The owner's in-game profile on the card; null parts are left out (the share options). */
export interface StygianProfile {
  name: string | null
  signature: string | null
  avatar: string
  frame: string
  uid: string | null
}

export interface StygianDrawing {
  record: GiStygianRecord
  seasonName: string
  /** The season's start and end, "YYYY-MM-DD hh:mm:ss" (month, dates). */
  start: string
  end: string
  /** The game version it ran in ("7.1"); null unknown. */
  version: string | null
  /** Per fight, the boss of that slot on the record's difficulty. */
  bosses: readonly (StygianBossArt | null)[]
  /** The account's characters now (newest capture): level and constellation by key. */
  roster: ReadonlyMap<string, { level: number; constellation: number }>
  theme: CardTheme
  profile: StygianProfile
  /** A co-op record's players for the foot line (none for solo cards and older captures). */
  players: readonly StygianCardPlayer[]
}

/** A player in the foot line: the badge, the picture, the name (null: the Name option is off). */
export interface StygianCardPlayer {
  p: number
  self: boolean
  /** The profile picture (a URL; '' none). */
  picture: string
  name: string | null
}

export interface DrawnStygian {
  canvas: HTMLCanvasElement
  missing: number
}

/** Design F's colours per card theme. */
const PALETTE = {
  dark: {
    base: [20, 13, 38],
    glow: 'rgba(139,92,246,0.26)',
    season: ['rgba(52,34,92,0.95)', 'rgba(30,20,56,0.95)'],
    panel: 'rgba(23,17,42,0.92)',
    chip: 'rgba(255,255,255,0.06)',
    pill: 'rgba(255,255,255,0.07)',
    line: 'rgba(255,255,255,0.12)',
    text: '#f1f5f9',
    sub: '#cbd5e1',
    muted: '#a3a0b8',
    accent: '#c4b5fd',
    time: '#ffd57a',
    boss: '#ff9a7a',
    artGround: ['#3a2063', '#17112a'],
    fastBg: 'rgba(45,212,191,0.22)',
    fastInk: '#5eead4',
    fastLine: 'rgba(94,234,212,0.5)',
    fade: [23, 17, 42],
  },
  light: {
    base: [245, 240, 252],
    glow: 'rgba(139,92,246,0.16)',
    season: ['rgba(255,255,255,0.95)', 'rgba(233,222,251,0.95)'],
    panel: 'rgba(255,255,255,0.92)',
    chip: 'rgba(124,77,196,0.07)',
    pill: 'rgba(255,255,255,0.92)',
    line: 'rgba(76,29,149,0.14)',
    text: '#1f1533',
    sub: '#4c3d68',
    muted: '#6f6288',
    accent: '#6d28d9',
    time: '#a15c07',
    boss: '#b4360b',
    artGround: ['#e4d6fa', '#fbf8ff'],
    fastBg: 'rgba(13,148,136,0.12)',
    fastInk: '#0f766e',
    fastLine: 'rgba(13,148,136,0.45)',
    fade: [253, 251, 255],
  },
} as const

const CREAM = '#e9e5dc'
const CREAM_INK = '#4a5366'

const rgba = (rgb: readonly number[], a: number) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`

export async function drawStygianCard(input: StygianDrawing, scale = 1): Promise<DrawnStygian> {
  const fights = input.record.fights
  const members = fights.map((f) => fightMembers(input.record, f))
  const keys = [
    ...new Set(
      fights.flatMap((f, i) => [
        ...members[i]!.map((m) => m.key),
        f.strike?.by ?? '',
        f.damage?.by ?? '',
      ]),
    ),
  ].filter(Boolean)
  const badges = [
    ...new Set([
      ...members.flat().flatMap((m) => (m.p === null ? [] : [coopBadge(m.p, m.self)])),
      ...input.players.map((pl) => coopBadge(pl.p, pl.self)),
    ]),
  ]
  const rarities = [...new Set(keys.map((key) => characterMeta(key)?.[0] ?? 4))]
  const elements = [...new Set(keys.map((key) => characterMeta(key)?.[1] ?? null))].filter(
    (e) => e !== null,
  )
  const { profile } = input
  const urls = [
    giCdnArt(stygianMedal(input.record)),
    profile.avatar,
    profile.frame,
    ...input.bosses.map((b) => b?.art ?? ''),
    ...keys.map((key) => characterIcon(key)),
    ...rarities.map((r) => qualityCell(r)),
    ...elements.map((e) => elementIcon(e)),
    ...badges,
    ...input.players.map((pl) => pl.picture),
  ].filter(Boolean)
  const [images, fonts] = await Promise.all([
    CardImages.load(urls),
    cardFonts([400, 600, 700, 800]),
  ])
  const { width, height } = STYGIAN_CARD
  const p = new Painter(width, height, scale)
  try {
    const card = new StygianPainter(p, input, members, images, fonts.tabular)
    card.ground()
    const pill = card.pillWidth()
    const header = stygianHeader(pill)
    card.profile(header.profile)
    card.best(header.pill)
    card.season(header.season)
    const { columns, foot } = stygianColumns(fights.length)
    columns.forEach((box, i) => card.fight(i, box))
    card.foot(foot)
    roundCorners(p.canvas, CARD_CORNER, scale)
    return { canvas: p.canvas, missing: images.missing }
  } finally {
    p.done()
    images.close()
  }
}

type Box = { x: number; y: number; w: number; h: number }

class StygianPainter extends CardPaint {
  private readonly c: (typeof PALETTE)['dark' | 'light']
  private readonly fastest: number
  private readonly total: number | null

  constructor(
    p: Painter,
    private readonly input: StygianDrawing,
    /** Each fight's characters, player by player (fightMembers). */
    private readonly members: readonly FightMember[][],
    images: CardImages,
    family: string,
  ) {
    super(p, input.theme, images, family)
    this.c = PALETTE[input.theme]
    this.fastest = fastestFight(input.record)
    this.total = recordTotal(input.record)
  }

  ground() {
    const { ctx } = this.p
    const { width, height } = STYGIAN_CARD
    ctx.fillStyle = rgba(this.c.base, 1)
    ctx.fillRect(0, 0, width, height)
    // `radial-gradient(circle at 50% 0%, glow 0%, transparent 45%)`: the
    // circle reaches the farthest corner.
    const r = Math.hypot(width / 2, height) * 0.45
    const glow = ctx.createRadialGradient(width / 2, 0, 0, width / 2, 0, r)
    glow.addColorStop(0, this.c.glow)
    glow.addColorStop(1, 'rgba(139,92,246,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, width, height)
  }

  /**
   * Paints `draw` on a layer of its own, then keeps it only as much as the
   * fade says (alpha by x across `box`, `fromRight` mirrors it): the part
   * fades to transparent, showing the ground, as CSS `mask-image` does.
   */
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

  /** The ground's colour laid over a fading part, more toward its far end (it dims as it fades). */
  private dim(box: Box, stops: readonly (readonly [number, number])[], fromRight: boolean) {
    const ctx = this.p.ctx
    const g = fromRight
      ? ctx.createLinearGradient(box.x + box.w, 0, box.x, 0)
      : ctx.createLinearGradient(box.x, 0, box.x + box.w, 0)
    for (const [at, alpha] of stops) g.addColorStop(at, rgba(this.c.base, alpha))
    ctx.fillStyle = g
    ctx.fillRect(box.x, box.y, box.w, box.h)
  }

  /** The owner: name card fading out, the profile picture in its frame, name, signature, UID. */
  profile(box: Box) {
    const p = this.p
    const { profile } = this.input
    // The season panel's ground, mirrored: solid at the card's edge, fading toward the medal.
    this.panel(box, false)

    const pic = PROFILE.picture
    const px = box.x + pic.x
    const py = box.y + pic.y
    const avatar = this.images.get(profile.avatar)
    if (avatar)
      p.clipped(px, py, pic.d, pic.d, pic.d / 2, () => p.cover(avatar, px, py, pic.d, pic.d))
    const frame = profile.frame ? this.images.get(profile.frame) : null
    if (frame) {
      // At the game's scale, centred on the picture; the card's edge cuts it.
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
        const lines = wrapLines(profile.signature, max, (s) => this.p.measure(s), 2)
        for (const line of lines) {
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

  private get bestText(): { label: string; value: string; size: number } {
    const fights = this.input.record.fights
    return this.total !== null
      ? { label: t('endgame.share.bestRecord'), value: formatSeconds(this.total), size: 84 }
      : {
          label: t('endgame.share.bestRecord'),
          value: t('endgame.captured.clearedOf', {
            n: fights.filter((f) => f.done).length,
            total: fights.length,
          }),
          size: 48,
        }
  }

  /** The medal pill's width: the medal, then the label and the time, as wide as the wider. */
  pillWidth(): number {
    const { label, value, size } = this.bestText
    const textW = Math.max(this.textWidth(label, 20, 700), this.textWidth(value, size, 800))
    return MEDAL_PILL.padLeft + MEDAL_PILL.medal + MEDAL_PILL.gap + textW + MEDAL_PILL.padRight
  }

  /** The best record: the medal and the total time, in a pill. */
  best(box: Box) {
    const p = this.p
    p.fill(box.x, box.y, box.w, box.h, box.h / 2, this.c.pill)
    p.insetRing(box.x, box.y, box.w, box.h, box.h / 2, 1, this.c.line)
    const medal = this.images.get(giCdnArt(stygianMedal(this.input.record)))
    const m = MEDAL_PILL.medal
    if (medal) p.contain(medal, box.x + MEDAL_PILL.padLeft, box.y + (box.h - m) / 2, m, m)
    const { label, value, size } = this.bestText
    const valueH = size
    const top = box.y + (box.h - 30 - valueH) / 2
    const x = box.x + MEDAL_PILL.padLeft + m + MEDAL_PILL.gap
    this.line(label, x, top, 20, 700, this.c.time, { lineHeight: 30 })
    this.line(value, x, top + 30, size, 800, this.c.time, { lineHeight: valueH })
  }

  /**
   * The header's side panel: the season colours at 135° (mirrored for the
   * left), dimmed toward and fading out at the medal's side. The profile
   * and the season use the same one, one the mirror of the other.
   */
  private panel(box: Box, fromRight: boolean) {
    this.faded(box, SEASON_FADE, fromRight, () => {
      const ctx = this.p.ctx
      const half = (box.w + box.h) / 4
      const cx = box.x + box.w / 2
      const cy = box.y + box.h / 2
      // 135° (top-left to bottom-right) on the right; mirrored, top-right to bottom-left.
      const g = fromRight
        ? ctx.createLinearGradient(cx - half, cy - half, cx + half, cy + half)
        : ctx.createLinearGradient(cx + half, cy - half, cx - half, cy + half)
      g.addColorStop(0, this.c.season[0])
      g.addColorStop(1, this.c.season[1])
      ctx.fillStyle = g
      ctx.fillRect(box.x, box.y, box.w, box.h)
      this.dim(box, SEASON_DIM, fromRight)
    })
  }

  /** The season: mode, month and version; its name; its dates. A panel fading toward the medal. */
  season(box: Box) {
    this.panel(box, true)
    const right = box.x + box.w - 28
    const max = box.w - 50
    const top = box.y + (box.h - (30 + 4 + 50.6 + 4 + 28.5)) / 2
    const labels = [
      t('endgame.modes.stygian'),
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
      top + 34 + 54.6,
      19,
      400,
      this.c.sub,
      {
        lineHeight: 28.5,
        align: 'right',
      },
    )
  }

  /** One battlefield: the boss's art, its name and title, the time, the team and the two figures. */
  fight(index: number, box: Box) {
    const fight = this.input.record.fights[index]
    if (!fight) return
    const { p } = this
    const ctx = p.ctx
    const { x, y, w, h } = box
    const c = this.c
    p.fill(x, y, w, h, 22, c.panel)

    // The boss: its art on the theme's ground, growing to fill what the
    // parts below leave, fading into the panel at its foot.
    const artH = h - columnFootH(w)
    const boss = this.input.bosses[index] ?? null
    const art = boss?.art ? this.images.get(boss.art) : null
    p.clipped(x, y, w, artH, [22, 22, 0, 0], () => {
      const gx = x + w / 2
      const gy = y + artH * 0.48
      const reach = Math.hypot(Math.max(gx - x, x + w - gx), Math.max(gy - y, y + artH - gy))
      const ground = ctx.createRadialGradient(gx, gy, 0, gx, gy, reach)
      ground.addColorStop(0, c.artGround[0])
      ground.addColorStop(0.71, c.artGround[1])
      ground.addColorStop(1, c.artGround[1])
      ctx.fillStyle = ground
      ctx.fillRect(x, y, w, artH)
      const s = COLUMN.art
      if (art) p.cover(art, x + w / 2 - s / 2, y + artH * 0.52 - s / 2, s, s)
      const fade = ctx.createLinearGradient(0, y + artH - COLUMN.artFade, 0, y + artH)
      fade.addColorStop(0, rgba(c.fade, 0))
      fade.addColorStop(1, rgba(c.fade, 1))
      ctx.fillStyle = fade
      ctx.fillRect(x, y + artH - COLUMN.artFade, w, COLUMN.artFade)
    })
    if (index === this.fastest) {
      const label = t('endgame.share.fastest')
      const lw = this.textWidth(label, 16, 700) + 28
      const lh = 24 + 10 + 2
      const lx = x + w - 18 - lw
      p.fill(lx, y + 18, lw, lh, lh / 2, c.fastBg)
      p.insetRing(lx, y + 18, lw, lh, lh / 2, 1, c.fastLine)
      this.line(label, lx + 14, y + 18 + 6, 16, 700, c.fastInk, { lineHeight: 24 })
    }
    p.insetRing(x, y, w, h, 22, 1, c.line)

    // The name (coral, as the game writes enemies) and its title, the time (gold) at the right.
    const x0 = x + COLUMN.pad
    const right = x + w - COLUMN.pad
    let cy = y + artH
    const rowH = COLUMN.nameH + 2 + COLUMN.titleH
    const time = formatSeconds(fight.time)
    const timeW = this.textWidth(time, 54, 800)
    const timeTop = cy + rowH - 51.3
    this.line(time, right, timeTop, 54, 800, fight.done ? c.time : c.muted, {
      lineHeight: 51.3,
      align: 'right',
    })
    // Not done: the time struck through (never the colour alone).
    if (!fight.done) p.fill(right - timeW - 2, timeTop + 26, timeW + 4, 4, 2, c.muted)
    const named = splitBossName(boss?.name || t('endgame.captured.fight', { n: index + 1 }))
    const nameMax = right - x0 - timeW - 16
    this.line(named.name, x0, cy, 26, 800, c.boss, { lineHeight: COLUMN.nameH, max: nameMax })
    if (named.title)
      this.line(named.title, x0, cy + COLUMN.nameH + 2, 17, 600, c.muted, {
        lineHeight: COLUMN.titleH,
        max: nameMax,
      })
    cy += rowH + COLUMN.gap

    // The team as bag cells.
    const cellW = (right - x0 - 3 * COLUMN.tileGap) / 4
    const cell = bagCell(cellW)
    this.members[index]!.slice(0, 4).forEach((m, i) =>
      this.tile(m, x0 + i * (cellW + COLUMN.tileGap), cy, cellW),
    )
    cy += cell.h + COLUMN.gap

    // The two figures.
    const figures = [
      { label: t('endgame.share.strike'), figure: fight.strike },
      { label: t('endgame.share.damage'), figure: fight.damage },
    ]
    figures.forEach((f, i) => {
      if (f.figure)
        this.figure(f.label, f.figure, x0, cy + i * (COLUMN.figureH + COLUMN.figureGap), right - x0)
    })
  }

  /**
   * A team member as the game's bag cell: portrait, element, constellation,
   * level on the cream strip, and in a co-op record its player's badge at the
   * bottom-left. Level and constellation: in a co-op record the record's own
   * (another player's characters have nothing else), the account's newest
   * capture where the record has none; on a solo card the newest capture.
   */
  private tile(member: FightMember, x: number, y: number, w: number) {
    const { p } = this
    const ctx = p.ctx
    const key = member.key
    const cell = bagCell(w)
    const meta = characterMeta(key)
    const rarity = meta?.[0] ?? 4
    const own = member.self ? this.input.roster.get(key) : undefined
    const now =
      this.input.record.coop && member.level !== undefined
        ? {
            level: member.level,
            constellation: member.constellation ?? own?.constellation ?? null,
          }
        : own
          ? { level: own.level, constellation: own.constellation as number | null }
          : undefined
    // On whole pixels, so the art, the portrait, the curl and the strip meet without seams.
    const [left, top, width, height] = p.snap(x, y, cell.w, cell.h)
    const stripTop = Math.round(top + height - cell.strip)
    p.clipped(left, top, width, height, cell.r, () => {
      const art = this.images.get(qualityCell(rarity))
      if (art) drawQualityCell(ctx, art, left, top, width, height)
      else p.fill(left, top, width, height, 0, rarity === 5 ? '#b7791f' : '#7c5ab8')
      // The portrait fills all of the cell above the strip (a little taller
      // than square: ~1% cropped off each side), standing on the strip as in
      // the game's bag, so no sliver of the cell shows above or below it.
      const portrait = this.images.get(characterIcon(key))
      if (portrait) p.cover(portrait, left, top, width, stripTop - top, { y: 1 })
      // The cell's inner curl over the strip's right end: a quarter circle cut
      // out of a square of cream, run 1px into the strip.
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
    if (now)
      this.line(
        t('endgame.level', { n: now.level }),
        left + width / 2,
        stripTop,
        cell.levelSize,
        700,
        CREAM_INK,
        { lineHeight: top + height - stripTop, align: 'center' },
      )
    const element = meta?.[1] ? this.images.get(elementIcon(meta[1])) : null
    if (element)
      p.contain(element, x + cell.element.x, y + cell.element.y, cell.element.d, cell.element.d)
    if (now && now.constellation !== null) {
      const chip = cell.chip
      const label = `C${now.constellation}`
      const lh = chip.size * 1.3
      const cw = this.textWidth(label, chip.size, 800) + 2 * chip.padX
      const ch = lh + 2 * chip.padY
      const cx = x + cell.w - chip.inset - cw
      const cy = y + chip.inset
      const gold = now.constellation >= 6
      if (gold)
        p.boxShadow(cx, cy, cw, ch, chip.r, { x: 0, y: 1, blur: 4, color: 'rgba(80,50,0,0.45)' })
      p.fill(cx, cy, cw, ch, chip.r, gold ? goldChip(ctx, cy, ch) : '#303048')
      this.line(label, cx + cw / 2, cy + chip.padY, chip.size, 800, gold ? '#8a4e24' : '#c8c8c8', {
        lineHeight: lh,
        align: 'center',
      })
    }
    // The player's badge (co-op): 38px on a 128px cell, standing on the strip.
    if (member.p !== null) {
      const d = (w * 38) / 128
      p.contain(
        this.images.get(coopBadge(member.p, member.self)),
        left + (w * 3) / 128,
        stripTop - d - 1,
        d,
        d,
      )
    }
  }

  /** A figure: whose it was (a round portrait), the label, the value. */
  private figure(label: string, figure: GiFigure, x: number, y: number, w: number) {
    const { p } = this
    const c = this.c
    const h = COLUMN.figureH
    p.fill(x, y, w, h, 16, c.chip)
    p.insetRing(x, y, w, h, 16, 1, c.line)
    let tx = x + 18
    if (figure.by) {
      const size = 42
      const px = x + 9
      const py = y + (h - size) / 2
      const portrait = this.images.get(characterIcon(figure.by))
      p.fill(px, py, size, size, size / 2, c.pill)
      if (portrait)
        p.clipped(px, py, size, size, size / 2, () => p.cover(portrait, px, py, size, size))
      tx = px + size + 12
    }
    const value = formatNumber(figure.value)
    const valueW = this.textWidth(value, 24, 800)
    this.line(value, x + w - 18, y + (h - 36) / 2, 24, 800, c.text, {
      lineHeight: 36,
      align: 'right',
    })
    this.line(label, tx, y + (h - 24) / 2, 16, 600, c.sub, {
      lineHeight: 24,
      max: x + w - 18 - valueW - 12 - tx,
    })
  }

  /** When the record was set, and the site. */
  foot(box: Box) {
    this.line(
      t('endgame.share.recordSet', { date: formatDate(this.input.record.at * 1000) }),
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
    this.players(box)
  }

  /**
   * A co-op record's players, centred in the foot line between the date and
   * the site: each the game's badge, the profile picture, the name (when the
   * Name option is on) and "You" on the account's own.
   */
  private players(box: Box) {
    const players = this.input.players
    if (!players.length) return
    const { p } = this
    const ctx = p.ctx
    const c = this.c
    const BADGE = 40
    const PIC = 40
    const GAP = 9
    const BETWEEN = 44
    const NAME = 19
    const YOU = 15
    const you = t('endgame.share.you')
    const youW = this.textWidth(you, YOU, 600) + 18
    const widths = players.map(
      (pl) =>
        BADGE +
        (pl.picture ? GAP + PIC : 0) +
        (pl.name ? GAP + this.textWidth(pl.name, NAME, 700) : 0) +
        (pl.self ? GAP + youW : 0),
    )
    const total = widths.reduce((a, b) => a + b, 0) + BETWEEN * (players.length - 1)
    const mid = box.y + box.h / 2
    let x = STYGIAN_CARD.width / 2 - total / 2
    players.forEach((pl, i) => {
      p.contain(this.images.get(coopBadge(pl.p, pl.self)), x, mid - BADGE / 2, BADGE, BADGE)
      let cx = x + BADGE
      const picture = pl.picture ? this.images.get(pl.picture) : null
      if (pl.picture) {
        cx += GAP
        const top = mid - PIC / 2
        p.clipped(cx, top, PIC, PIC, PIC / 2, () => {
          p.fill(cx, top, PIC, PIC, 0, c.chip)
          if (picture) p.cover(picture, cx, top, PIC, PIC)
        })
        ctx.save()
        ctx.beginPath()
        ctx.arc(cx + PIC / 2, mid, PIC / 2 - 1, 0, Math.PI * 2)
        ctx.lineWidth = 2
        ctx.strokeStyle =
          this.input.theme === 'dark' ? 'rgba(255,255,255,0.55)' : 'rgba(76,29,149,0.35)'
        ctx.stroke()
        ctx.restore()
        cx += PIC
      }
      if (pl.name) {
        cx += GAP
        this.line(pl.name, cx, mid - (NAME * 1.3) / 2, NAME, 700, c.text, {
          lineHeight: NAME * 1.3,
        })
        cx += this.textWidth(pl.name, NAME, 700)
      }
      if (pl.self) {
        cx += GAP
        const h = YOU * 1.3 + 4
        ctx.save()
        p.path(cx, mid - h / 2, youW, h, h / 2)
        ctx.lineWidth = 1
        ctx.strokeStyle = c.line
        ctx.stroke()
        ctx.restore()
        this.line(you, cx + youW / 2, mid - (YOU * 1.3) / 2, YOU, 600, c.muted, {
          lineHeight: YOU * 1.3,
          align: 'center',
        })
      }
      x += widths[i]! + BETWEEN
    })
  }
}

/** The season's dates, "Sep 30 – Nov 11, 2026" in the site's language (the calendar days it names). */
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
