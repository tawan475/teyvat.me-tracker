import { characterImages, weaponImages } from '@gdt/game-data/images'
import { formatWishTime, toGoodKey, type UigfGachaType, type WishItem } from '@gdt/shared'
import type { BannerRun, Outcome, PityBand, PullRow } from '@/data/wish-history'
import { t } from '@/i18n'
import { locale } from '@/i18n/locale'
import { imageUrl } from '@/lib/assets'
import { dateFormat } from '@/lib/format'

export interface WishBannerInfo {
  banner: UigfGachaType
  /** The detail page's path segment. */
  slug: string
  /** Short and long name, in the language on screen (read when drawn). */
  readonly label: string
  readonly title: string
  /** Whether its 5★ has a 50/50 (75/25 on the weapon banner). */
  rated: boolean
}

function banner(id: UigfGachaType, slug: string, rated: boolean): WishBannerInfo {
  return {
    banner: id,
    slug,
    rated,
    get label() {
      return t(`wishes.banners.${slug}.label`)
    },
    get title() {
      return t(`wishes.banners.${slug}.title`)
    },
  }
}

/** Banners in the game's Wish screen order. */
export const WISH_BANNERS: readonly WishBannerInfo[] = [
  banner(301, 'character', true),
  banner(302, 'weapon', true),
  banner(200, 'standard', false),
  banner(500, 'chronicled', false),
  banner(100, 'beginners', false),
]

export function bannerBySlug(slug: unknown): WishBannerInfo | undefined {
  return WISH_BANNERS.find((b) => b.slug === slug)
}

export function bannerInfo(banner: UigfGachaType): WishBannerInfo {
  return WISH_BANNERS.find((b) => b.banner === banner)!
}

/**
 * The game's icon name of a pulled item, from the game data's images by
 * GOOD key: the item's own, or for an item kept as it came (a name the
 * wish table doesn't know yet) its name's toGoodKey, as a character or a
 * weapon. undefined when the game data has no picture for it.
 */
export function wishIconName(item: WishItem): string | undefined {
  const key = item.key ?? toGoodKey(item.name)
  if (!key) return undefined
  const character = () => characterImages(key)?.icon
  const weapon = () => weaponImages(key)?.[0]
  return item.kind === 'weapon'
    ? weapon()
    : item.kind === 'character'
      ? character()
      : (character() ?? weapon())
}

export function wishIcon(item: WishItem): string {
  return imageUrl(wishIconName(item))
}

/** The game's clock, to the minute ("2026-10-12 21:04"). */
export const wishMinute = (time: number) => formatWishTime(time).slice(0, 16)

/** A month's short name ("Oct"; "10月" in Chinese), 0-based. */
const monthShort = (index: number) => t(`wishes.date.months.${index + 1}`)
const thisYear = () => new Date().getFullYear()

/**
 * A wall-clock day ("Oct 3"; "Oct 3, 2024" in another year), from seconds
 * read as UTC; English always reads this way, whatever the browser's locale.
 */
export function wishDay(time: number, year = thisYear()): string {
  const d = new Date(time * 1000)
  // Other languages through Intl: a month after a day can take another form
  // (Russian "12 мая", not the month list's "май").
  if (locale.value !== 'en') {
    const sameYear = d.getUTCFullYear() === year
    return dateFormat({
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
      timeZone: 'UTC',
    }).format(d)
  }
  const parts = { month: monthShort(d.getUTCMonth()), day: d.getUTCDate() }
  return d.getUTCFullYear() === year
    ? t('wishes.date.day', parts)
    : t('wishes.date.dayYear', { ...parts, year: d.getUTCFullYear() })
}

/** A pull's game-clock time as the table shows it ("Oct 3, 13:34"). */
export function wishShortTime(time: number, year = thisYear()): string {
  return t('wishes.date.dayTime', {
    day: wishDay(time, year),
    time: formatWishTime(time).slice(11, 16),
  })
}

/** A month key ("2026-10") as "Oct 2026". */
export function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  return t('wishes.date.month', { month: monthShort(m - 1), year: y })
}

/**
 * A banner run's dates on the data's clock (UTC+8): "Aug 12 – Sep 2", the
 * year once at the end when it isn't this one, "Sep 23 – now" while open.
 */
export function runDates(run: BannerRun, open: boolean, year = thisYear()): string {
  const start = run.banner.start + 8 * 3600
  const end = run.banner.end + 8 * 3600
  if (open) return t('wishes.date.range', { from: wishDay(start, year), to: t('wishes.date.now') })
  const endYear = new Date(end * 1000).getUTCFullYear()
  const startYear = new Date(start * 1000).getUTCFullYear()
  const from = wishDay(start, startYear === endYear ? startYear : year)
  return t('wishes.date.range', { from, to: wishDay(end, year) })
}

/**
 * A 5★ pity band's colour, from the theme's tokens (blue, gold, orange,
 * red; never green against red: the site is colour-blind friendly, and the
 * number itself is always shown).
 */
export const BAND_COLOR: Record<PityBand, string> = {
  early: 'var(--accent-text)',
  mid: 'var(--rarity-5)',
  soft: 'var(--pity-soft)',
  late: 'var(--danger-text)',
}

/**
 * How a 50/50 outcome looks everywhere (colour-blind friendly: a mark and a
 * line style as well as a colour, blue against orange, never green/red):
 * ▲ won (blue, solid ring), ▼ lost (orange, dashed), ● guaranteed (grey, dotted),
 * ✦ Capturing Radiance (blue like a win — it is one — with a double ring).
 */
export const OUTCOME_STYLE = {
  won: {
    mark: '▲',
    text: 'text-accent-text',
    ring: 'outline-accent-text outline-solid',
    bar: 'bg-accent-text',
    tone: 'accent',
  },
  lost: {
    mark: '▼',
    text: 'text-warning-text',
    ring: 'outline-warning-text outline-dashed',
    bar: 'bg-[repeating-linear-gradient(45deg,var(--color-warning-text)_0_5px,color-mix(in_srgb,var(--color-warning-text)_50%,transparent)_5px_10px)]',
    tone: 'warning',
  },
  guaranteed: {
    mark: '●',
    text: 'text-text-secondary',
    ring: 'outline-text-secondary outline-dotted',
    bar: 'bg-text-secondary',
    tone: 'neutral',
  },
  radiance: {
    mark: '✦',
    text: 'text-accent-text',
    ring: 'outline-accent-text outline-double outline-3',
    bar: 'bg-accent-text',
    tone: 'accent',
  },
} as const satisfies Record<
  Outcome,
  { mark: string; text: string; ring: string; bar: string; tone: string }
>

/** An outcome's badge text ("Won", "Lost", "Guaranteed"), in the language on screen. */
export const outcomeLabel = (outcome: Outcome): string => t(`wishes.outcomes.${outcome}`)

export const oddsOf = (banner: UigfGachaType) => (banner === 302 ? '75/25' : '50/50')

/** Tooltip of an outcome; the weapon banner's 5★ odds are 75/25. */
export function outcomeTitle(outcome: Outcome, banner: UigfGachaType, rank = 5): string {
  const odds = rank === 5 ? oddsOf(banner) : '50/50'
  return t(`wishes.outcomeTitles.${outcome}`, { odds })
}

/** The banner a pull was made on, by name ('' outside the banner data). */
export function runName(row: PullRow): string {
  const on = row.on
  if (!on) return ''
  if (row.pull.gachaType === 400 && on.name400) return on.name400
  return on.name
}

export const RARITY_TEXT: Record<number, string> = {
  5: 'text-rarity-5',
  4: 'text-rarity-4',
  3: 'text-text-secondary',
}

/**
 * A pity's colour: blue when early, through amber, to red at hard pity (as
 * paimon.moe draws it, with blue for its green: colour-blind friendly) (`hard`: 90 / 80 for a 5★, 10 for a 4★). Mixed from
 * the theme's tokens, so it reads in both themes.
 */
export function pityColor(pity: number, hard: number): string {
  const x = Math.min(1, Math.max(0, (pity - 1) / Math.max(1, hard - 1)))
  return x < 0.5
    ? `color-mix(in oklab, var(--warning-text) ${Math.round(x * 200)}%, var(--accent-text))`
    : `color-mix(in oklab, var(--danger-text) ${Math.round((x - 0.5) * 200)}%, var(--warning-text))`
}

export const formatPercent = (share: number) =>
  `${(share * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`

export const formatPity = (pity: number) =>
  pity.toLocaleString('en-US', { maximumFractionDigits: 2 })
