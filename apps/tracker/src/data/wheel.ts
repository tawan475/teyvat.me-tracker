/**
 * The wheel (docs/plans/fun.md): a list the user types, one entry per line,
 * and a spin that lands on one. Pure geometry and text handling; the
 * component draws and animates.
 *
 * Angles are degrees clockwise from the top, where the pointer is. At
 * rotation 0 entry `i` of `n` covers `[i, i + 1) * 360 / n`.
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

/** The wheel's face: slices in the tones given, never the same tone side by side, a line between. */
export function wheelGradient(n: number, tones: readonly string[], line: string): string {
  if (n <= 1) return tones[0] ?? 'transparent'
  const slice = 360 / n
  const edge = Math.min(0.4, slice / 8)
  const stops: string[] = []
  for (let i = 0; i < n; i++) {
    // An odd count would put the first tone beside itself where the wheel closes.
    const tone = tones.length > 2 && n % 2 && i === n - 1 ? tones[2]! : tones[i % 2]!
    const from = i * slice
    const to = (i + 1) * slice
    stops.push(`${line} ${from}deg ${from + edge}deg`, `${tone} ${from + edge}deg ${to}deg`)
  }
  return `conic-gradient(${stops.join(', ')})`
}

/** How a label's centre line is turned: along the middle of its slice, reading outwards. */
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
