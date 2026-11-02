import type { Directive } from 'vue'

/**
 * `v-sticky-head` on a table's `<thead>`: the header stays under the app bar
 * while its table scrolls past, like `position: sticky`, which can't work
 * here: the tables sit in a sideways-scrolling box on narrow screens, and a
 * scroll box is what a sticky element sticks to. So the header is slid down
 * by the page's scroll instead (one transform per scroll event, which the
 * browser sends once a frame; read from two rects), never past its table's
 * last row. Opt-in per table.
 *
 * The value, when given, is how many more px to keep clear below the app
 * bar (a sticky toolbar above the table): a number or a function read on
 * every scroll. `false` leaves the header where it is (a shared table that
 * only some pages pin).
 */
type Clearance = number | (() => number) | false | undefined

interface State {
  update: () => void
  clearance: Clearance
}

const states = new WeakMap<HTMLElement, State>()

/** The app bar's bottom edge (the shell's sticky header), 0 without one. */
function appBarBottom(): number {
  return document.querySelector('[data-app-bar]')?.getBoundingClientRect().bottom ?? 0
}

export const vStickyHead: Directive<HTMLElement, Clearance> = {
  mounted(head, binding) {
    const table = head.closest('table')
    if (!table || binding.value === false) return
    const state: State = {
      clearance: binding.value,
      update: () => {
        const extra =
          typeof state.clearance === 'function' ? state.clearance() : state.clearance || 0
        const top = appBarBottom() + extra
        const box = table.getBoundingClientRect()
        const room = box.height - head.offsetHeight
        const shift = Math.round(Math.min(Math.max(top - box.top, 0), Math.max(room, 0)))
        head.style.transform = shift ? `translateY(${shift}px)` : ''
        head.toggleAttribute('data-stuck', shift > 0)
      },
    }
    // Above the rows it slides over (their pinned cells are stacked too).
    head.style.position = 'relative'
    head.style.zIndex = '5'
    states.set(head, state)
    window.addEventListener('scroll', state.update, { passive: true })
    window.addEventListener('resize', state.update, { passive: true })
    state.update()
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
    window.removeEventListener('scroll', state.update)
    window.removeEventListener('resize', state.update)
    states.delete(head)
  },
}
