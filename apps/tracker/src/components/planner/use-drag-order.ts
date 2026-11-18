import { nextTick, onBeforeUnmount, shallowRef } from 'vue'

/**
 * Where the lifted copy (UiDragGhost) is drawn: the pointer, and where in
 * the handle it was grabbed, so the copy's handle stays under it.
 */
export interface DragLift {
  x: number
  y: number
  dx: number
  dy: number
  /** The copy's least width: the dragged item's (`data-drag-item`, else the handle's), a little less. */
  width: number
}

/** Scrolling along while a drag rests near an edge of the list's scroller. */
export interface EdgeScroll {
  /** The band (px) at the top and bottom edges. */
  band: number
  /** Pixels a frame, at the edge itself when `ramp`. */
  speed: number
  /** Faster nearer the edge (else the same speed across the band). */
  ramp: boolean
  /** Nothing is targeted while the pointer is in a band. */
  blind: boolean
  /** The window only: pixels kept clear at its bottom ('tab-bar' = the phone's bar). */
  inset: number | 'tab-bar'
}

/** The Planner's, as they were before the tab bar shared this. */
const PLANNER_EDGE: EdgeScroll = { band: 72, speed: 12, ramp: false, blind: false, inset: 56 }

/** A move before this many pixels is still a tap on the handle (no lifted copy). */
const LIFT_AFTER = 4

/**
 * Reordering by dragging a handle, with a mouse, a finger or a pen (pointer
 * events; the handle has `touch-action: none` so a drag on it doesn't
 * scroll), and by keyboard on the focused handle (arrows move one place,
 * Home/End to the ends). Near the top or bottom edge of the list's scroller
 * (the window, or a scrolling dialog body) the list scrolls along. Escape,
 * or a drop on no target, cancels.
 *
 * By default (the Planner) cards carry `data-goal-card="<id>"` and handles
 * `data-goal-handle="<id>"`: dropping on a card moves the dragged one to its
 * place (`move(id, to)`). `target` and `drop` replace that (the tab bar's
 * two lists, UiSortableLists); `handle` names the handles' data attribute.
 * `lift` follows the pointer once it has moved, for the lifted copy.
 */
export function useDragOrder<Over = string>(handlers: {
  move?: (id: string, to: string) => void
  step: (id: string, delta: number | 'start' | 'end') => void
  target?: (x: number, y: number, id: string) => Over | null
  drop?: (id: string, over: Over) => void
  same?: (a: Over | null, b: Over | null) => boolean
  /** The handles' data attribute, without `data-` (default `goal-handle`). */
  handle?: string
  edge?: Partial<EdgeScroll>
}) {
  const edge: EdgeScroll = { ...PLANNER_EDGE, ...handlers.edge }
  const handleAttr = handlers.handle ?? 'goal-handle'
  const dragging = shallowRef<string | null>(null)
  const over = shallowRef<Over | null>(null)
  const lift = shallowRef<DragLift | null>(null)
  let pointer: { x: number; y: number } | null = null
  let grab: { x: number; y: number; dx: number; dy: number; width: number } | null = null
  let scroller: HTMLElement | null = null
  let frame = 0

  function cardAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-goal-card]')
    return el?.dataset.goalCard ?? null
  }

  const same = handlers.same ?? ((a: Over | null, b: Over | null) => a === b)
  function setOver(next: Over | null) {
    if (!same(next, over.value)) over.value = next
  }

  /** The scroller's visible edges (the window's, or a scrolling element's). */
  function bounds(): { top: number; bottom: number } {
    if (scroller) {
      const rect = scroller.getBoundingClientRect()
      return { top: Math.max(0, rect.top), bottom: Math.min(window.innerHeight, rect.bottom) }
    }
    let inset = 0
    if (edge.inset === 'tab-bar') {
      inset = document.querySelector('[data-tab-bar]')?.getBoundingClientRect().height ?? 0
    } else inset = edge.inset
    return { top: 0, bottom: window.innerHeight - inset }
  }

  /** How far to scroll this frame (0: the pointer is not in a band). */
  function scrollStep(y: number): number {
    const { top, bottom } = bounds()
    const share = (into: number) => (edge.ramp ? Math.max(0.15, 1 - into / edge.band) : 1)
    if (y < top + edge.band) return -Math.ceil(edge.speed * share(Math.max(0, y - top)))
    if (y > bottom - edge.band) return Math.ceil(edge.speed * share(Math.max(0, bottom - y)))
    return 0
  }

  function retarget() {
    const id = dragging.value
    if (!id || !pointer) return
    if (edge.blind && scrollStep(pointer.y) !== 0) {
      setOver(null)
      return
    }
    setOver(
      handlers.target
        ? handlers.target(pointer.x, pointer.y, id)
        : (cardAt(pointer.x, pointer.y) as Over | null),
    )
  }

  /** Scrolls while the pointer rests near the scroller's top or bottom edge. */
  function scroll() {
    frame = 0
    if (!dragging.value || !pointer) return
    const by = scrollStep(pointer.y)
    if (by !== 0) {
      if (scroller) scroller.scrollBy(0, by)
      else window.scrollBy(0, by)
      retarget()
    }
    frame = requestAnimationFrame(scroll)
  }

  function onMove(event: PointerEvent) {
    if (!dragging.value) return
    pointer = { x: event.clientX, y: event.clientY }
    if (grab && !lift.value) {
      const moved = Math.hypot(event.clientX - grab.x, event.clientY - grab.y)
      if (moved >= LIFT_AFTER)
        lift.value = { x: 0, y: 0, dx: grab.dx, dy: grab.dy, width: grab.width }
    }
    if (lift.value) lift.value = { ...lift.value, x: event.clientX, y: event.clientY }
    retarget()
    if (!frame) frame = requestAnimationFrame(scroll)
  }

  /** After a real drag the release's click (e.g. on a dialog's backdrop) does nothing. */
  function swallowClick() {
    const eat = (event: Event) => {
      event.stopPropagation()
      event.preventDefault()
    }
    window.addEventListener('click', eat, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', eat, { capture: true }), 0)
  }

  function stop(drop: boolean) {
    const id = dragging.value
    const to = over.value
    const lifted = lift.value !== null
    dragging.value = null
    over.value = null
    lift.value = null
    pointer = null
    grab = null
    scroller = null
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onEscape, true)
    if (lifted) swallowClick()
    if (!drop || !id || to === null) return
    if (handlers.drop) handlers.drop(id, to)
    else if (to !== (id as unknown as Over)) handlers.move?.(id, to as unknown as string)
  }
  const onUp = () => stop(true)
  const onCancel = () => stop(false)
  function onEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    stop(false)
  }

  /** The nearest scrolling ancestor of the handle, or null for the window. */
  function scrollerOf(el: Element | null): HTMLElement | null {
    for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
      if (node === document.body || node === document.documentElement) return null
      const style = getComputedStyle(node)
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight)
        return node
    }
    return null
  }

  function start(id: string, event: PointerEvent) {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget instanceof Element ? event.currentTarget : null
    const rect = handle?.getBoundingClientRect()
    const item = handle?.closest('[data-drag-item]')?.getBoundingClientRect() ?? rect
    grab = {
      width: Math.max(160, Math.min(290, (item?.width ?? 200) - 24)),
      x: event.clientX,
      y: event.clientY,
      dx: rect ? Math.max(4, Math.min(rect.width - 4, event.clientX - rect.left)) : 16,
      dy: rect ? Math.max(4, Math.min(20, event.clientY - rect.top)) : 16,
    }
    scroller = scrollerOf(handle)
    dragging.value = id
    over.value = handlers.target ? null : (id as unknown as Over)
    pointer = { x: event.clientX, y: event.clientY }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onEscape, true)
  }

  function key(id: string, event: KeyboardEvent) {
    const by = {
      ArrowUp: -1,
      ArrowLeft: -1,
      ArrowDown: 1,
      ArrowRight: 1,
      Home: 'start' as const,
      End: 'end' as const,
    }[event.key]
    if (by === undefined) return
    event.preventDefault()
    handlers.step(id, by)
    // The item moved in the list: its handle keeps the focus.
    void nextTick(() =>
      document.querySelector<HTMLElement>(`[data-${handleAttr}="${CSS.escape(id)}"]`)?.focus(),
    )
  }

  onBeforeUnmount(() => stop(false))
  return { dragging, over, lift, start, key }
}
