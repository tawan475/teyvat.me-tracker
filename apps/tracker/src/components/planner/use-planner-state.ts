import type {
  CharacterCurrent,
  CurrentOverride,
  InventoryAdjustment,
  InventoryChange,
  PlannerStateResponse,
  WeaponCurrent,
  currentOverride,
} from '@gdt/shared'
import type { z } from 'zod'
import { computed, shallowRef, watch, type Ref } from 'vue'
import { ApiRequestError, api } from '@/api'
import { t } from '@/i18n'
import { useFeedback } from '@/stores/feedback'
import { applyChanges, mergeChange, overrideId } from './hand-edits'

export type CurrentChange = z.input<typeof currentOverride>

/** What to write: material changes and current states (null: the capture's again). */
export interface StateChanges {
  inventory?: InventoryChange[]
  current?: CurrentChange[]
}

const DEBOUNCE_MS = 500

const changeId = (c: CurrentChange) =>
  overrideId(c.kind === 'weapon' ? c : { kind: c.kind, key: c.key })

/**
 * The account's hand edits on top of the newest capture (material counts,
 * goals' current state), with optimistic writes like the goals store:
 * `change` shows at once and sends after a short pause (typing a count, ±),
 * `commit` sends now (a Done and its Undo, the goal editor).
 *
 * Every write names the capture it was made against (`base`: the newest
 * capture's `lastSeenAt` as the page shows it). If a newer capture landed
 * first the server writes nothing (409): the store re-reads, brings the
 * account up to date, and sends again what only sets values (a typed count,
 * a current state); a Done, which takes amounts away, is dropped and said so.
 */
export function usePlannerState(
  accountId: Ref<number>,
  base: Ref<number>,
  onCaptureChanged: (accountId: number) => Promise<void>,
  /** Runs before each send (the goals' own writes: a current state lands only on a stored goal). */
  before: () => Promise<void> = async () => {},
  /**
   * The sighting of the capture the bag is from (hand-edits.ts
   * `bagSighting`): older than `base` while the newest capture left
   * materials out, so the edits made since the bag's capture are kept.
   */
  bagBase: Ref<number> = base,
) {
  const feedback = useFeedback()
  /** The server's answer; the view is this plus what is waiting to be sent. */
  const server = shallowRef<PlannerStateResponse | null>(null)
  const error = shallowRef<unknown>(null)
  const saving = shallowRef(false)
  const inventory = new Map<string, InventoryChange>()
  const current = new Map<string, CurrentChange>()
  /** Bumped on every local change, so the views recompute. */
  const tick = shallowRef(0)
  let timer: ReturnType<typeof setTimeout> | undefined
  let flight: Promise<void> | null = null
  let generation = 0
  let loadedId = accountId.value
  /** The capture the waiting changes were made against (the page's when the first was made). */
  let queuedBase = base.value

  async function load(keep = false) {
    const mine = ++generation
    inventory.clear()
    current.clear()
    clearTimeout(timer)
    loadedId = accountId.value
    error.value = null
    if (!keep) server.value = null
    try {
      const response = await api.plannerState(loadedId)
      if (mine === generation) server.value = response
    } catch (cause) {
      if (mine === generation) error.value = cause
    }
  }

  watch(
    accountId,
    () => {
      if (inventory.size + current.size > 0) {
        void send(loadedId, queuedBase, takePending()).catch(() => {})
      }
      void load()
    },
    { immediate: true },
  )

  /** Material edits as the server will have them. */
  const adjustments = computed<InventoryAdjustment[] | null>(() => {
    void tick.value
    const s = server.value
    if (!s) return null
    return inventory.size
      ? applyChanges(s.adjustments, inventory.values(), base.value, Date.now(), bagBase.value)
      : s.adjustments
  })

  /** Current states set by hand, by goal id. */
  const overrides = computed<Map<string, CharacterCurrent | WeaponCurrent> | null>(() => {
    void tick.value
    const s = server.value
    if (!s) return null
    const map = new Map<string, CharacterCurrent | WeaponCurrent>(
      s.overrides.map((o: CurrentOverride) => [overrideId(o), o.current]),
    )
    for (const [id, c] of current) {
      if (c.current) map.set(id, c.current)
      else map.delete(id)
    }
    return map
  })

  function takePending(): StateChanges {
    const changes = { inventory: [...inventory.values()], current: [...current.values()] }
    inventory.clear()
    current.clear()
    return changes
  }

  function queue(changes: StateChanges) {
    if (inventory.size + current.size === 0) queuedBase = base.value
    for (const c of changes.inventory ?? [])
      inventory.set(c.key, mergeChange(inventory.get(c.key), c))
    for (const c of changes.current ?? []) current.set(changeId(c), c)
    tick.value++
  }

  function send(id: number, at: number, changes: StateChanges & { prune?: boolean }) {
    const bag = bagBase.value
    return api.updatePlannerState(id, {
      base: at,
      // Only while the newest capture left materials out (and is the one sent against).
      ...(bag < at && at === base.value ? { bagBase: bag } : {}),
      inventory: changes.inventory ?? [],
      current: changes.current ?? [],
      ...(changes.prune ? { prune: true } : {}),
    })
  }

  const isConflict = (cause: unknown) =>
    cause instanceof ApiRequestError && cause.status === 409 && cause.code === 'capture_changed'

  async function flush(extra: { prune?: boolean } = {}): Promise<void> {
    clearTimeout(timer)
    timer = undefined
    await before()
    while (flight) await flight.catch(() => {})
    if (inventory.size + current.size === 0 && !extra.prune) return
    const madeAgainst = inventory.size + current.size > 0 ? queuedBase : base.value
    const changes = { ...takePending(), ...extra }
    const mine = generation
    const id = loadedId
    saving.value = true
    flight = (async () => {
      try {
        for (let attempt = 1; ; attempt++) {
          try {
            // First as made; again (after catching up) against the newest capture.
            const response = await send(id, attempt === 1 ? madeAgainst : base.value, changes)
            if (mine === generation) {
              server.value = response
              tick.value++
            }
            return
          } catch (cause) {
            if (mine !== generation) return
            if (!isConflict(cause)) throw cause
            // A newer capture landed first: catch up with it (keeping what waits).
            await onCaptureChanged(id)
            const fresh = await api.plannerState(id)
            if (mine !== generation) return
            server.value = fresh
            tick.value++
            const relative = (changes.inventory ?? []).some((c) => c.set === undefined)
            if (relative || attempt >= 2) {
              feedback.toast({
                tone: 'info',
                title: t('planner.toast.newCapture'),
                detail: t('planner.toast.newCaptureDetail'),
              })
              throw cause
            }
          }
        }
      } catch (cause) {
        if (mine !== generation) return
        if (!isConflict(cause)) {
          feedback.error(t('planner.toast.notSaved'), cause)
          await load(true)
        }
        throw cause
      } finally {
        saving.value = false
        flight = null
      }
    })()
    await flight
  }

  return {
    error,
    saving,
    /** The server's newest capture time (null: none, or not loaded). */
    capturedAt: computed(() => server.value?.capturedAt ?? null),
    adjustments,
    overrides,
    loaded: computed(() => server.value !== null),
    reload: () => load(),
    /** Shows now, sends after a short pause (merged with other quick changes). */
    change(changes: StateChanges) {
      queue(changes)
      clearTimeout(timer)
      timer = setTimeout(() => void flush().catch(() => {}), DEBOUNCE_MS)
    },
    /** Shows now, sends now; rejects when nothing was written. */
    async commit(changes: StateChanges): Promise<void> {
      queue(changes)
      await flush()
    },
    /** Drops the edits a newer capture replaced. */
    prune: () => flush({ prune: true }).catch(() => {}),
    /** Sends what waits, then re-reads (a change made in another tab or device). */
    async refresh() {
      await flush().catch(() => {})
      await load(true)
    },
    /** Sends anything still waiting (on leaving the page). */
    flush: () => flush().catch(() => {}),
  }
}
