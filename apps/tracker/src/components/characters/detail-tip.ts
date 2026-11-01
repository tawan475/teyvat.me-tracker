/**
 * What a part of the character details does, on hover or click: the
 * details (CharacterDetail) provide one tip, the parts (talents,
 * constellations, weapon, artifact sets and pieces, element) spread `bind(subject)` on
 * their element. A mouse hovering shows the tip while it stays; a click (or
 * a tap, Enter, Space) pins it and rings the part until it is clicked again,
 * another part is, or Escape / a click elsewhere closes it. Outside the
 * details nothing is provided (the roster's tiles keep their plain titles).
 */

import { inject, provide, shallowRef, type InjectionKey } from 'vue'

export type TipSubject =
  | { kind: 'talent'; index: number }
  | { kind: 'constellation'; index: number }
  | { kind: 'weapon' }
  | { kind: 'set'; setKey: string }
  /** Every set the build wears (the share card's sets panel). */
  | { kind: 'sets' }
  /** One worn artifact, by GOOD slot. */
  | { kind: 'piece'; slot: string }
  | { kind: 'element' }

export interface TipShown {
  subject: TipSubject
  anchor: HTMLElement
  pinned: boolean
  /** Beside the part rather than under it (a part in a column: constellations, pieces). */
  side: boolean
}

export interface TipOptions {
  /** The share card is scaled down: its ring is drawn thicker. */
  ring?: 'page' | 'card'
  side?: boolean
}

export function subjectId(subject: TipSubject): string {
  switch (subject.kind) {
    case 'talent':
    case 'constellation':
      return `${subject.kind}:${subject.index}`
    case 'set':
      return `set:${subject.setKey}`
    case 'piece':
      return `piece:${subject.slot}`
    default:
      return subject.kind
  }
}

/** How long a mouse rests on a part before its tip shows. */
const HOVER_DELAY = 120

export function createDetailTip() {
  const hover = shallowRef<TipShown | null>(null)
  const pinned = shallowRef<TipShown | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancel() {
    clearTimeout(timer)
    timer = undefined
  }

  function toggle(subject: TipSubject, anchor: HTMLElement, side: boolean) {
    cancel()
    hover.value = null
    pinned.value =
      pinned.value && subjectId(pinned.value.subject) === subjectId(subject)
        ? null
        : { subject, anchor, pinned: true, side }
  }

  function close() {
    cancel()
    hover.value = null
    pinned.value = null
  }

  /** The props a part spreads: handlers, the ring while pinned, a button's semantics. */
  function bind(subject: TipSubject, { ring = 'page', side = false }: TipOptions = {}) {
    const id = subjectId(subject)
    const on = pinned.value !== null && subjectId(pinned.value.subject) === id
    return {
      role: 'button',
      tabindex: 0,
      'aria-expanded': on,
      'data-tip': id,
      class: ['detail-tip-target', `detail-tip-${ring}`, on ? 'detail-tip-on' : ''],
      onPointerenter(event: PointerEvent) {
        if (event.pointerType !== 'mouse') return
        const anchor = event.currentTarget as HTMLElement
        cancel()
        timer = setTimeout(() => {
          hover.value = { subject, anchor, pinned: false, side }
        }, HOVER_DELAY)
      },
      onPointerleave() {
        cancel()
        hover.value = null
      },
      onClick(event: MouseEvent) {
        // A link inside the part (the weapon's name) keeps its own click.
        if ((event.target as Element | null)?.closest('a')) return
        toggle(subject, event.currentTarget as HTMLElement, side)
      },
      onKeydown(event: KeyboardEvent) {
        if (event.key !== 'Enter' && event.key !== ' ') return
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        toggle(subject, event.currentTarget as HTMLElement, side)
      },
    }
  }

  return { hover, pinned, bind, close }
}

export type DetailTip = ReturnType<typeof createDetailTip>

const KEY: InjectionKey<DetailTip> = Symbol('detail-tip')

export function provideDetailTip(tip: DetailTip): void {
  provide(KEY, tip)
}

/** The details' tip, or null outside them. */
export function useDetailTip(): DetailTip | null {
  return inject(KEY, null)
}
