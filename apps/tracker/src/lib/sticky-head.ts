import type { Directive } from 'vue'
import { appBarBottom } from './sticky-stack'

/**
 * `v-sticky-head` on a table's `<thead>`: the header stays under the app bar
 * (and under a sticky toolbar above the table, lib/sticky-stack) while its
 * table scrolls past. Opt-in per table.
 *
 * - The table fits its box (desktop, nearly always): the boxes around it stop
 *   being scroll boxes (`overflow: clip`) and the header is plain
 *   `position: sticky`, which the browser moves with the scroll itself: no
 *   lag (the user saw the transform version trail the page).
 * - It is wider than its box (a phone, scrolling it sideways): a scroll box
 *   is what a sticky element sticks to, so the header is slid down by the
 *   page's scroll instead (a transform per scroll event), never past the
 *   table's last row.
 *
 * The value, when given, is more px to keep clear (a bar above the table
 * that isn't a sticky toolbar: Snapshots' selection bar): a number or a
 * function. `false` leaves the header where it is (a shared table that only
 * some pages pin).
 */
type Clearance = number | (() => number) | false | undefined

interface State {
  clearance: Clearance
  /** The boxes between the table and the page that clip (and what they had). */
  boxes: { el: HTMLElement; overflowX: string; overflowY: string }[]
  css: boolean
  top: string
  update: () => void
  check: () => void
  observer: ResizeObserver
}

const states = new WeakMap<HTMLElement, State>()

/** The sticky toolbar's height (sticky-stack), 0 without one. */
function toolbarHeight(): number {
  return (
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--stick-toolbar')) || 0
  )
}

function clearanceOf(state: State): number {
  const c = state.clearance
  return typeof c === 'function' ? c() : c || 0
}

/** The ancestors up to the page that make a scroll box (overflow other than visible / clip). */
function clippingBoxes(table: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = []
  for (let el = table.parentElement; el && el.tagName !== 'MAIN'; el = el.parentElement) {
    if (el === document.body) break
    const s = getComputedStyle(el)
    if (/auto|scroll|hidden/.test(`${s.overflowX} ${s.overflowY}`)) out.push(el)
  }
  return out
}

export const vStickyHead: Directive<HTMLElement, Clearance> = {
  mounted(head, binding) {
    const table = head.closest('table')
    if (!table || binding.value === false) return
    const state: State = {
      clearance: binding.value,
      boxes: [],
      css: false,
      top: '',
      update: () => {
        const top = Math.round(appBarBottom() + toolbarHeight() + clearanceOf(state))
        const box = table.getBoundingClientRect()
        if (state.css) {
          const value = `${top}px`
          if (state.top !== value) head.style.top = state.top = value
          head.toggleAttribute('data-stuck', box.top < top)
          return
        }
        const room = box.height - head.offsetHeight
        const shift = Math.round(Math.min(Math.max(top - box.top, 0), Math.max(room, 0)))
        head.style.transform = shift ? `translateY(${shift}px)` : ''
        head.toggleAttribute('data-stuck', shift > 0)
      },
      check: () => {
        // Undo the clip first, so the measure sees the boxes as authored.
        for (const b of state.boxes) {
          b.el.style.overflowX = b.overflowX
          b.el.style.overflowY = b.overflowY
        }
        const boxes = clippingBoxes(table)
        const fits = boxes.every((el) => el.scrollWidth <= el.clientWidth + 1)
        state.boxes = boxes.map((el) => ({
          el,
          overflowX: el.style.overflowX,
          overflowY: el.style.overflowY,
        }))
        state.css = fits
        if (fits) {
          for (const b of state.boxes) {
            b.el.style.overflowX = 'clip'
            b.el.style.overflowY = 'clip'
          }
          head.style.position = 'sticky'
          head.style.transform = ''
        } else {
          head.style.position = 'relative'
          head.style.top = state.top = ''
        }
        state.update()
      },
      observer: new ResizeObserver(() => state.check()),
    }
    // Above the rows it covers (their pinned cells are stacked too).
    head.style.zIndex = '5'
    states.set(head, state)
    state.observer.observe(table)
    if (table.parentElement) state.observer.observe(table.parentElement)
    window.addEventListener('scroll', state.update, { passive: true })
    window.addEventListener('resize', state.check, { passive: true })
    state.check()
  },
  updated(head, binding) {
    const state = states.get(head)
    if (!state) return
    state.clearance = binding.value
    state.update()
  },
  unmounted(head) {
    const state = states.get(head)
    if (!state) return
    state.observer.disconnect()
    for (const b of state.boxes) {
      b.el.style.overflowX = b.overflowX
      b.el.style.overflowY = b.overflowY
    }
    window.removeEventListener('scroll', state.update)
    window.removeEventListener('resize', state.check)
    states.delete(head)
  },
}
