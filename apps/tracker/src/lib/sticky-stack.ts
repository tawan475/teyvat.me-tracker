import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

/**
 * The sticky stack under the app bar (the user's ask, 2026-11-02): a list's
 * toolbar sticks flush to the app bar and a table header right under it,
 * like one block. A sticky toolbar reports its height as `--stick-toolbar`
 * on the root (0 when it isn't sticky: below lg, unless `always`), which the
 * table headers add to their top (lib/sticky-head). It also carries
 * `data-stuck` while it is pinned, so it can square its top and join the
 * app bar.
 */

/** The app bar's bottom edge (the shell's sticky header), 0 without one. */
export function appBarBottom(): number {
  return document.querySelector('[data-app-bar]')?.getBoundingClientRect().bottom ?? 0
}

/** Where a pinned element's top sits: the app bar's foot. */
const PINNED = 1

let owners = 0

export function useStickyToolbar(
  el: Readonly<Ref<HTMLElement | null>>,
  enabled: () => boolean,
  options: { always?: boolean } = {},
) {
  const wide = window.matchMedia('(min-width: 1024px)')
  let observer: ResizeObserver | null = null
  let active = false

  const report = () => {
    const node = el.value
    const on = !!node && enabled() && (options.always || wide.matches)
    document.documentElement.style.setProperty(
      '--stick-toolbar',
      on ? `${node!.offsetHeight}px` : '0px',
    )
    mark()
  }
  const mark = () => {
    const node = el.value
    if (!node) return
    const on = enabled() && (options.always || wide.matches)
    node.toggleAttribute(
      'data-stuck',
      on && node.getBoundingClientRect().top <= appBarBottom() + PINNED,
    )
  }

  function start() {
    if (active || !el.value || !enabled()) return
    active = true
    owners++
    observer = new ResizeObserver(report)
    observer.observe(el.value)
    window.addEventListener('scroll', mark, { passive: true })
    wide.addEventListener('change', report)
    report()
  }
  function stop() {
    if (!active) return
    active = false
    owners--
    observer?.disconnect()
    observer = null
    window.removeEventListener('scroll', mark)
    wide.removeEventListener('change', report)
    el.value?.removeAttribute('data-stuck')
    if (owners === 0) document.documentElement.style.removeProperty('--stick-toolbar')
  }

  onMounted(start)
  watch([el, enabled], () => {
    stop()
    start()
  })
  onBeforeUnmount(stop)
}
