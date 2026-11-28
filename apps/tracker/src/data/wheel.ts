/**
 * The wheel (docs/plans/fun.md): a list the user types, one entry per line,
 * and a spin that lands on one. Pure geometry and text handling; the
 * component draws and animates.
 *
 * Angles are degrees clockwise from the top. At rotation 0 entry `i` of `n`
 * covers `[i, i + 1) * 360 / n`, and the maths' pointer is at the top; the
 * drawn pointer is at the right (`POINTER_ANGLE`, `faceTurn`).
 */

export const MAX_ENTRIES = 500
export const MAX_ENTRY_LENGTH = 80

/** The entries of the text box: trimmed lines, empty ones dropped. */
export function parseEntries(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim().slice(0, MAX_ENTRY_LENGTH)
    if (entry) out.push(entry)
    if (out.length >= MAX_ENTRIES) break
  }
  return out
}

/** The text without the first line that reads `entry`. */
export function withoutEntry(text: string, entry: string): string {
  const lines = text.split(/\r?\n/)
  const at = lines.findIndex((line) => line.trim().slice(0, MAX_ENTRY_LENGTH) === entry)
  if (at >= 0) lines.splice(at, 1)
  return lines.join('\n')
}

export function shuffled<T>(list: readonly T[], random: () => number = Math.random): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

const mod360 = (deg: number) => ((deg % 360) + 360) % 360

/** Which entry is under the pointer when the wheel is turned `rotation` degrees clockwise. */
export function indexAt(rotation: number, n: number): number {
  if (n <= 0) return -1
  return Math.min(n - 1, Math.floor(mod360(-rotation) / (360 / n)))
}

/**
 * Where a spin ends: the first rotation at least `turns` full turns past
 * `from` that puts entry `index` under the pointer, `within` (0 to 1) of the
 * way through its slice, so it never stops on a line.
 */
export function landing(
  from: number,
  index: number,
  n: number,
  turns: number,
  within = 0.5,
): number {
  const slice = 360 / n
  const at = (index + Math.min(0.9, Math.max(0.1, within))) * slice
  const least = from + turns * 360
  return least + mod360(-at - least)
}

/**
 * Where the pointer sits on screen, degrees clockwise from the top: at the
 * right (3 o'clock), so the winning entry's label reads level, left to right
 * from the hub outwards. The maths above keeps its pointer at the top; the
 * drawn face is turned by this much more (`faceTurn`), which puts the same
 * entry under the drawn pointer.
 */
export const POINTER_ANGLE = 90

/** The CSS rotation of the drawn face (degrees clockwise) at `rotation`. */
export const faceTurn = (rotation: number) => rotation + POINTER_ANGLE

/** Which entry the drawn face shows under the pointer when turned `turn` degrees (the check of `faceTurn`). */
export function indexOnScreen(turn: number, n: number): number {
  if (n <= 0) return -1
  return Math.min(n - 1, Math.floor(mod360(POINTER_ANGLE - turn) / (360 / n)))
}

/** A slice's fill and the ink of its label (at least 4.5:1 on it). */
export interface WheelTone {
  fill: string
  ink: string
}

const INK = '#0f172a'
const WHITE = '#ffffff'

/**
 * The slices' colours, the same in both themes: light and dark in turn, so
 * neighbours differ in lightness and never by hue alone (the site's
 * colour-blind rule). Dark ink on the light ones, white on the dark ones.
 */
export const WHEEL_TONES: readonly WheelTone[] = [
  { fill: '#38bdf8', ink: INK },
  { fill: '#4338ca', ink: WHITE },
  { fill: '#fbbf24', ink: INK },
  { fill: '#0f766e', ink: WHITE },
  { fill: '#f9a8d4', ink: INK },
  { fill: '#1d4ed8', ink: WHITE },
]

/**
 * The last slice of an odd count: it sits between a dark slice and the first
 * (light) one, so it takes a mid tone, lighter than every dark tone and darker
 * than every light one.
 */
export const CLOSING_TONE: WheelTone = { fill: '#ea580c', ink: INK }

/** Slice `i` of `n`'s colours. */
export function sliceTone(i: number, n: number): WheelTone {
  if (n > 1 && n % 2 === 1 && i === n - 1) return CLOSING_TONE
  return WHEEL_TONES[i % WHEEL_TONES.length]!
}

/** The wheel's face: each slice in its tone, a thin line between two. */
export function wheelGradient(n: number, line: string): string {
  if (n <= 0) return 'transparent'
  if (n === 1) return sliceTone(0, 1).fill
  const slice = 360 / n
  const edge = Math.min(0.35, slice / 8)
  const stops: string[] = []
  for (let i = 0; i < n; i++) {
    const tone = sliceTone(i, n).fill
    const from = i * slice
    const to = (i + 1) * slice
    stops.push(`${line} ${from}deg ${from + edge}deg`, `${tone} ${from + edge}deg ${to}deg`)
  }
  return `conic-gradient(${stops.join(', ')})`
}

/** How a label's centre line is turned on the face: along the middle of its slice, reading outwards. */
export const labelAngle = (index: number, n: number) => (index + 0.5) * (360 / n) - 90

// ------------------------------------------------------------ share link

/** A list as the `#w=` part of a link: base64url of its JSON. */
export function encodeShare(entries: readonly string[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(entries))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The public wheel page every share link opens (signed out too). */
export const WHEEL_PUBLIC_PATH = '/fun/wheel'

/**
 * The link Share copies: always the public wheel page on this site's origin
 * (`location.origin`, so the dev server and a self-host link to themselves),
 * from the app, the guest, the demo and the public page alike.
 */
export function wheelShareUrl(origin: string, entries: readonly string[]): string {
  return `${origin.replace(/\/+$/, '')}${WHEEL_PUBLIC_PATH}#w=${encodeShare(entries)}`
}

/** The list a link carries; null when it carries none or it cannot be read. */
export function decodeShare(hash: string): string[] | null {
  const match = /(?:^|[#&])w=([A-Za-z0-9_-]+)/.exec(hash)
  if (!match) return null
  try {
    const binary = atob(match[1]!.replace(/-/g, '+').replace(/_/g, '/'))
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!Array.isArray(value)) return null
    return parseEntries(value.filter((v) => typeof v === 'string').join('\n'))
  } catch {
    return null
  }
}
