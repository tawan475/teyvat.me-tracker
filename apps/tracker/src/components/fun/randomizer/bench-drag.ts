import { onBeforeUnmount, watch, type Ref } from 'vue'
import { rangeBench } from './bench-range'

/**
 * Dragging across the pool's tiles, as a phone's gallery selects pictures:
 * the tile the drag starts on flips, and every tile from it to the one under
 * the pointer (in reading order) takes that same state; going back gives the
 * tiles left behind their old state again. A mouse drags at once; a finger
 * holds still for a moment first, so a swipe still scrolls the page. A plain
 * click or tap stays the tile's own.
 */

/** How long a finger rests before its drag selects, and how far it may stray meanwhile. */
const HOLD_MS = 350
const HOLD_SLOP = 10

interface Drag {
  pointer: number
  touch: boolean
  x: number
  y: number
  from: number
  bench: boolean
  before: string[]
  keys: string[]
  active: boolean
  timer: number
}

export function useBenchDrag(
  grid: Ref<HTMLElement | null>,
  options: {
    /** The shown tiles' keys, in order. Tiles carry theirs as `data-bench-key`. */
    keys: () => string[]
    benched: () => string[]
    set: (benched: string[]) => void
  },
) {
  let drag: Drag | null = null
  /** The click that ends a drag is not a toggle. */
  let swallow = false

  function keyAt(x: number, y: number): string | null {
    const tile = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-bench-key]')
    return tile && grid.value?.contains(tile) ? (tile.dataset.benchKey ?? null) : null
  }

  function paint(to: number) {
    if (!drag) return
    options.set(rangeBench(drag.before, drag.keys, drag.from, to, drag.bench))
  }

  function begin(event?: PointerEvent) {
    if (!drag || drag.active) return
    drag.active = true
    swallow = true
    // Past the grid's edge the drag goes on (a mouse; a finger is held by its tile already).
    if (event && !drag.touch) {
      try {
        grid.value?.setPointerCapture(event.pointerId)
      } catch {
        // No such pointer any more: the drag still works inside the grid.
      }
    }
    paint(drag.from)
  }

  function end() {
    if (drag) window.clearTimeout(drag.timer)
    drag = null
  }

  function down(event: PointerEvent) {
    end()
    swallow = false
    if (event.button !== 0 || !event.isPrimary) return
    const key = keyAt(event.clientX, event.clientY)
    const keys = options.keys()
    const from = key == null ? -1 : keys.indexOf(key)
    if (from < 0) return
    const before = options.benched()
    const touch = event.pointerType !== 'mouse'
    drag = {
      pointer: event.pointerId,
      touch,
      x: event.clientX,
      y: event.clientY,
      from,
      bench: !before.includes(keys[from]!),
      before: [...before],
      keys,
      active: false,
      timer: touch ? window.setTimeout(() => begin(), HOLD_MS) : 0,
    }
  }

  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.pointer) return
    const key = keyAt(event.clientX, event.clientY)
    const to = key == null ? -1 : drag.keys.indexOf(key)
    if (!drag.active) {
      if (drag.touch) {
        // A finger that moves before the hold is scrolling.
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > HOLD_SLOP) end()
        return
      }
      if (to < 0 || to === drag.from) return
      begin(event)
    }
    if (to >= 0) paint(to)
  }

  function up(event: PointerEvent) {
    if (drag && event.pointerId === drag.pointer) end()
  }

  function click(event: MouseEvent) {
    if (!swallow) return
    swallow = false
    event.stopPropagation()
    event.preventDefault()
  }

  /** A selecting finger must not scroll the page, nor open the long-press menu. */
  function touchMove(event: TouchEvent) {
    if (drag?.active && event.cancelable) event.preventDefault()
  }
  function menu(event: Event) {
    if (drag?.touch) event.preventDefault()
  }
  /** The browser's own drag of a portrait would end ours. */
  function noDrag(event: Event) {
    event.preventDefault()
  }

  // The grid arrives with the data, after the board itself.
  watch(
    grid,
    (el) => {
      if (!el) return
      el.addEventListener('pointerdown', down)
      el.addEventListener('pointermove', move)
      el.addEventListener('pointerup', up)
      el.addEventListener('pointercancel', up)
      el.addEventListener('click', click, true)
      el.addEventListener('touchmove', touchMove, { passive: false })
      el.addEventListener('contextmenu', menu)
      el.addEventListener('dragstart', noDrag)
    },
    { immediate: true, flush: 'post' },
  )
  onBeforeUnmount(end)
}
