import type { PoolCharacter } from '@/data/team-randomizer'

/**
 * The team randomizer's motion: transform and opacity only, short, and none
 * of it under `prefers-reduced-motion`.
 */

/** One slot's animation; a new `id` starts it. */
export interface Spin {
  id: number
  /** `roll`: the reel; `snap`: the tile fades back in (Undo). */
  kind: 'roll' | 'snap'
  /** Who passes by before the result. */
  through: readonly PoolCharacter[]
  /** ms */
  duration: number
}

/** How many portraits pass by before a slot stops. */
export const REEL = 5
const FIRST_MS = 420
const STEP_MS = 90

/** Slots stop one after another: the n-th of a roll (0 = first), ms. Eight end at 1,050. */
export const spinDuration = (n: number): number => FIRST_MS + n * STEP_MS

/** `count` random characters of `pool` to run past. */
export function passersBy(
  pool: readonly PoolCharacter[],
  count = REEL,
  random: () => number = Math.random,
): PoolCharacter[] {
  if (!pool.length) return []
  return Array.from({ length: count }, () => pool[Math.floor(random() * pool.length)]!)
}

/** A slot that stops, a lock, a ban. */
export const POP: Keyframe[] = [
  { transform: 'scale(1)' },
  { transform: 'scale(1.06)' },
  { transform: 'scale(1)' },
]
export const SNAP: Keyframe[] = [
  { transform: 'scale(0.94)', opacity: 0.3 },
  { transform: 'scale(1)', opacity: 1 },
]

export function reducedMotion(): boolean {
  return typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Plays `frames` on `el`, unless motion is off. */
export function play(el: Element | null | undefined, frames: Keyframe[], duration: number): void {
  if (!el || reducedMotion()) return
  el.animate(frames, { duration, easing: 'ease-out' })
}
