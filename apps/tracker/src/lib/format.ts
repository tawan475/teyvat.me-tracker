/**
 * Formatting. "Say the real number": counts and sizes are exact or carry a
 * unit, never vague. Everything follows the language on screen
 * (i18n/locale): English numbers as en-US (as always), every other language in
 * its own locale (Chinese compact numbers in 万 / 亿); dates in English follow
 * the browser's locale (as always), in the other languages the language's.
 */

import { t } from '@/i18n'
import { locale } from '@/i18n/locale'

/** The locale numbers are written in. */
export function numberLocale(): string {
  return locale.value === 'en' ? 'en-US' : locale.value
}

/** The locale dates are written in: the browser's in English, the language's otherwise. */
export function dateLocale(): string | undefined {
  return locale.value === 'en' ? undefined : locale.value
}

const numberFormats = new Map<string, Intl.NumberFormat>()
/** An Intl.NumberFormat for the language on screen, built once per language and options. */
export function numberFormat(options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${numberLocale()}|${JSON.stringify(options)}`
  let format = numberFormats.get(key)
  if (!format) {
    format = new Intl.NumberFormat(numberLocale(), options)
    numberFormats.set(key, format)
  }
  return format
}

const dateFormats = new Map<string, Intl.DateTimeFormat>()
/** An Intl.DateTimeFormat for the language on screen, built once per language and options. */
export function dateFormat(options: Intl.DateTimeFormatOptions = {}): Intl.DateTimeFormat {
  const key = `${dateLocale() ?? ''}|${JSON.stringify(options)}`
  let format = dateFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(dateLocale(), options)
    dateFormats.set(key, format)
  }
  return format
}

const COMPACT = { notation: 'compact', maximumFractionDigits: 1 } as const

export function formatNumber(value: number): string {
  return numberFormat().format(value)
}

/**
 * Whole seconds with their unit, as the game's Stygian Onslaught timer shows
 * a run: "78s" in English (narrow), "78 วิ" / "78 秒" / "78 с" elsewhere (the
 * short unit: narrow drops the space Thai writes). The user's call,
 * 2026-11-05, over "1:18".
 */
export function formatSeconds(seconds: number): string {
  return numberFormat({
    style: 'unit',
    unit: 'second',
    unitDisplay: numberLocale() === 'en-US' ? 'narrow' : 'short',
    maximumFractionDigits: 0,
  }).format(seconds)
}

/** 72,164,464 -> "72.2M" (Chinese "7216.4万"); small numbers stay exact. */
export function formatCompact(value: number): string {
  return Math.abs(value) < 10_000 ? formatNumber(value) : numberFormat(COMPACT).format(value)
}

/** Compact from 1,000 on ("2.9K"): a figure in a narrow place (a roster card's bars). */
export function formatShort(value: number): string {
  return Math.abs(value) < 1_000 ? formatNumber(value) : numberFormat(COMPACT).format(value)
}

export function formatSigned(value: number): string {
  if (value === 0) return '0'
  return `${value > 0 ? '+' : '−'}${formatCompact(Math.abs(value))}`
}

/**
 * An axis tick, compact with as many decimals (up to three) as the `step`
 * between ticks needs: over an hour Mora moves in 50K steps, which one
 * decimal would print as "9.1M, 9.1M, 9.2M".
 */
export function formatCompactTick(value: number, step: number): string {
  const abs = Math.abs(value)
  if (abs < 10_000 || !(step > 0)) return formatCompact(value)
  // Chinese, Japanese and Korean compact numbers step in 万/萬/만 (1e4) and
  // 亿/億/억 (1e8); the other languages in thousands, like English's K / M / B / T.
  const unit = !/^(zh|ja|ko)/.test(locale.value)
    ? abs >= 1e12
      ? 1e12
      : abs >= 1e9
        ? 1e9
        : abs >= 1e6
          ? 1e6
          : 1e3
    : abs >= 1e12
      ? 1e12
      : abs >= 1e8
        ? 1e8
        : 1e4
  const scaled = step / unit
  let digits = 1
  while (digits < 3 && Math.abs(Math.round(scaled * 10 ** digits) - scaled * 10 ** digits) > 1e-6) {
    digits++
  }
  return numberFormat({ notation: 'compact', maximumFractionDigits: digits }).format(value)
}

/** As formatCompactTick, signed ("+150K", "−1.25M"). */
export function formatSignedTick(value: number, step: number): string {
  if (value === 0) return '0'
  return `${value > 0 ? '+' : '−'}${formatCompactTick(Math.abs(value), step)}`
}

/** The step between a Chart.js axis's ticks (0 with fewer than two). */
export function tickStep(ticks: readonly { value: number }[]): number {
  return ticks.length > 1 ? Math.abs(ticks[1]!.value - ticks[0]!.value) : 0
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

let use24Hour = false

/** Set from the user's settings. */
export function setClockPreference(twentyFourHour: boolean): void {
  use24Hour = twentyFourHour
}

export function clock24(): boolean {
  return use24Hour
}

/** The original tracker's date-time: the browser's full locale format, with seconds. */
export function formatFullDateTime(ms: number | string | Date): string {
  return new Date(ms).toLocaleString(dateLocale(), { hour12: !use24Hour })
}

export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(dateLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: !use24Hour,
  })
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(dateLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(dateLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !use24Hour,
  })
}

/** "Oct 4": a date without its year. */
export function formatMonthDay(ms: number): string {
  return new Date(ms).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' })
}

/** Whether two times fall on the same local day. */
export function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString()
}

/** Keeps a date or time on one line when the text around it wraps ("4:41 PM", not "4:41" / "PM"). */
export function nowrap(text: string): string {
  return text.replaceAll(' ', '\u00a0')
}

/**
 * Some time between two moments, as short as stays clear: "between Oct 1
 * and Oct 4, 2026" (the year once when both share it), "between Dec 28,
 * 2025 and Jan 4, 2026", or within one day "Oct 4, 2026, between 9:10 AM
 * and 4:05 PM". Each date and time stays on one line.
 */
export function formatBetween(from: number, to: number): string {
  if (sameDay(from, to)) {
    return t('format.betweenTimes', {
      date: nowrap(formatDate(to)),
      from: nowrap(formatTime(from)),
      to: nowrap(formatTime(to)),
    })
  }
  const sameYear = new Date(from).getFullYear() === new Date(to).getFullYear()
  const start = sameYear ? formatMonthDay(from) : formatDate(from)
  return t('format.betweenDates', { from: nowrap(start), to: nowrap(formatDate(to)) })
}

const relatives = new Map<string, Intl.RelativeTimeFormat>()
function relativeFormat(): Intl.RelativeTimeFormat {
  let format = relatives.get(locale.value)
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale.value, { numeric: 'auto' })
    relatives.set(locale.value, format)
  }
  return format
}

/** "3 hours ago", "yesterday", "in 2 days". */
export function formatRelative(ms: number, now = Date.now()): string {
  const seconds = Math.round((ms - now) / 1000)
  const abs = Math.abs(seconds)
  const relative = relativeFormat()
  if (abs < 45) return t('format.justNow')
  if (abs < 45 * 60) return relative.format(Math.round(seconds / 60), 'minute')
  if (abs < 22 * 3600) return relative.format(Math.round(seconds / 3600), 'hour')
  if (abs < 26 * 86400) return relative.format(Math.round(seconds / 86400), 'day')
  if (abs < 320 * 86400) return relative.format(Math.round(seconds / (30 * 86400)), 'month')
  return relative.format(Math.round(seconds / (365 * 86400)), 'year')
}

/** "KamisatoAyaka" -> "Kamisato Ayaka" (GOOD keys are PascalCase). */
export function keyToName(key: string): string {
  return key
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .trim()
}
