import type { ProgressHistory, PlannerTarget } from '@gdt/shared'
import { shallowRef, watch, type Ref } from 'vue'
import { api } from '@/api'
import { t } from '@/i18n'
import { useFeedback } from '@/stores/feedback'
import { targetId, type TargetInput, type TargetRef } from './model'

type Op = { kind: 'upsert'; input: TargetInput } | { kind: 'remove'; ref: TargetRef }

const DEBOUNCE_MS = 500

function apply(targets: readonly PlannerTarget[], ops: Iterable<Op>): PlannerTarget[] {
  const byId = new Map(targets.map((t) => [targetId(t), t]))
  const now = Date.now()
  for (const op of ops) {
    if (op.kind === 'remove') {
      const ref = op.ref
      // A weapon named without its id: every goal with that weapon and owner (as the server does).
      if (ref.kind === 'weapon' && !ref.id) {
        for (const [id, t] of byId) {
          if (t.kind === 'weapon' && t.key === ref.key && t.owner === ref.owner) byId.delete(id)
        }
      } else byId.delete(targetId(ref))
      continue
    }
    const input = op.input
    const active = input.target.active ?? true
    let target: PlannerTarget
    if (input.kind === 'weapon') {
      // Its id names it: a goal that changes weapon or owner replaces its old entry.
      const goalId = input.id ?? ''
      for (const [id, t] of byId) if (t.kind === 'weapon' && t.id === goalId) byId.delete(id)
      target = {
        kind: 'weapon',
        id: goalId,
        key: input.key,
        owner: input.owner,
        target: { ...input.target, active },
        updatedAt: now,
      }
    } else if (input.kind === 'custom') {
      target = {
        kind: 'custom',
        key: input.key,
        owner: '',
        target: { ...input.target, active, custom: { ...input.target.custom } },
        updatedAt: now,
      }
    } else if (input.kind === 'item') {
      target = {
        kind: 'item',
        key: input.key,
        owner: '',
        target: { ...input.target, active },
        updatedAt: now,
      }
    } else {
      target = {
        kind: 'character',
        key: input.key,
        owner: '',
        target: { ...input.target, active },
        updatedAt: now,
      }
    }
    byId.set(targetId(target), target)
  }
  return [...byId.values()]
}

/** The key pending ops are merged by: a weapon goal by its own id. */
const opKey = (op: Op) => {
  const t = op.kind === 'remove' ? op.ref : op.input
  return t.kind === 'weapon' && t.id ? `weapon#${t.id}` : targetId(t)
}

/**
 * The account's planner targets with optimistic writes. `change` applies at
 * once on screen and sends after a short pause, merged with other quick
 * changes (toggling several goals is one request); `commit` sends at once
 * (dialog saves, imports). Requests go one at a time; a failed one reloads
 * the server's state and says so.
 */
export function usePlannerTargets(accountId: Ref<number>) {
  const feedback = useFeedback()
  const targets = shallowRef<PlannerTarget[] | null>(null)
  const error = shallowRef<unknown>(null)
  const saving = shallowRef(false)
  /** Time travel: whether a plan was recorded for the time shown (progress_history). */
  const history = shallowRef<ProgressHistory | null>(null)
  /** Server state; `targets` is this plus the pending ops. */
  let server: PlannerTarget[] = []
  const pending = new Map<string, Op>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let flight: Promise<void> | null = null
  let generation = 0

  /** The account `server` and `pending` belong to. */
  let loadedId = accountId.value

  /** `keep` leaves the current list on screen while the server's arrives. */
  async function load(keep = false) {
    const mine = ++generation
    pending.clear()
    clearTimeout(timer)
    loadedId = accountId.value
    error.value = null
    if (!keep) targets.value = null
    try {
      const response = await api.plannerTargets(loadedId)
      if (mine !== generation) return
      server = response.targets
      history.value = response.history ?? null
      targets.value = server
    } catch (cause) {
      if (mine === generation) error.value = cause
    }
  }

  // Switching accounts: send what is still waiting for the old one, then load.
  watch(
    accountId,
    () => {
      if (pending.size > 0) void send(loadedId, [...pending.values()]).catch(() => {})
      void load()
    },
    { immediate: true },
  )

  function send(id: number, ops: Op[]) {
    return api.updatePlannerTargets(id, {
      upsert: ops.flatMap((op) => (op.kind === 'upsert' ? [op.input] : [])),
      remove: ops.flatMap((op) => (op.kind === 'remove' ? [op.ref] : [])),
    })
  }

  function queue(ops: Op[]) {
    for (const op of ops) {
      const id = opKey(op)
      // Later ops come after earlier ones, also for the same goal.
      pending.delete(id)
      pending.set(id, op)
    }
    targets.value = apply(server, pending.values())
  }

  async function flush(): Promise<void> {
    clearTimeout(timer)
    timer = undefined
    while (flight) await flight.catch(() => {})
    if (pending.size === 0) return
    const ops = [...pending.values()]
    pending.clear()
    const mine = generation
    saving.value = true
    flight = (async () => {
      try {
        const response = await send(loadedId, ops)
        if (mine !== generation) return
        server = response.targets
        targets.value = apply(server, pending.values())
      } catch (cause) {
        if (mine !== generation) return
        feedback.error(t('planner.toast.notSaved'), cause)
        await load(true)
        throw cause
      } finally {
        saving.value = false
        flight = null
      }
    })()
    await flight
  }

  /** Optimistic change, sent after a short pause. */
  function change(ops: Op[]) {
    queue(ops)
    clearTimeout(timer)
    timer = setTimeout(() => void flush().catch(() => {}), DEBOUNCE_MS)
  }

  /** Optimistic change, sent now; rejects when the server refused it. */
  async function commit(ops: Op[]): Promise<void> {
    queue(ops)
    await flush()
  }

  return {
    targets,
    history,
    error,
    saving,
    reload: () => load(),
    change,
    commit,
    /** Sends what waits, then re-reads (a change made in another tab or device). */
    async refresh() {
      await flush().catch(() => {})
      await load(true)
    },
    /** Sends anything still waiting (on leaving the page). */
    flush: () => flush().catch(() => {}),
  }
}

export const upsert = (input: TargetInput): Op => ({ kind: 'upsert', input })
export const remove = (ref: TargetRef): Op => ({ kind: 'remove', ref })
