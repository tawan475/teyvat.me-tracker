import { onScopeDispose, shallowRef, watch } from 'vue'
import { api } from '@/api'
import { onPlannerChange } from '@/live/planner-changes'
import { updatesHeld } from '@/live/holds'
import { t } from '@/i18n'
import { useFeedback } from '@/stores/feedback'

/** Where a list of hand marks is read and saved, and what a failed save says. */
export interface MarksApi {
  read: (accountId: number) => Promise<{ done: number[] }>
  write: (
    accountId: number,
    body: { done: number[]; undone: number[] },
  ) => Promise<{ done: number[] }>
  notSaved: () => string
}

const ANECDOTES: MarksApi = {
  read: (id) => api.anecdoteMarks(id),
  write: (id, body) => api.updateAnecdoteMarks(id, body),
  notSaved: () => t('anecdotes.notSaved'),
}

/** The account's anecdotes marked done by hand (useHandMarks). */
export function useAnecdoteMarks(accountId: () => number, readOnly = false) {
  return useHandMarks(ANECDOTES, accountId, readOnly)
}

/**
 * Ids an account marked done by hand (anecdotes, quests). Changes show at once
 * (optimistic) and are saved one request at a time, in order; the server's
 * answer replaces the local list once nothing else is waiting. A failed save
 * says so and reloads the list from the server. Marks made in another tab or
 * on another device arrive as a `planner` live event and are re-read.
 * Read-only (staff Inspect): nothing is read or saved.
 */
export function useHandMarks(marks: MarksApi, accountId: () => number, readOnly = false) {
  const feedback = useFeedback()
  const marked = shallowRef<ReadonlySet<number>>(new Set())
  /** The account `marked` belongs to; null while the first load runs. */
  const loadedFor = shallowRef<number | null>(null)
  const error = shallowRef<unknown>()
  let generation = 0
  let queue: Promise<unknown> = Promise.resolve()
  let pending = 0

  async function load(id: number) {
    const mine = ++generation
    error.value = undefined
    if (readOnly) {
      loadedFor.value = id
      return
    }
    try {
      const { done } = await marks.read(id)
      if (mine !== generation) return
      marked.value = new Set(done)
      loadedFor.value = id
    } catch (cause) {
      if (mine === generation) error.value = cause
    }
  }

  watch(
    accountId,
    (id) => {
      loadedFor.value = null
      marked.value = new Set()
      void load(id)
    },
    { immediate: true },
  )

  /** Marks `done` and unmarks `undone`; resolves false when saving failed. */
  function change(done: readonly number[], undone: readonly number[] = []): Promise<boolean> {
    if (readOnly || (done.length === 0 && undone.length === 0)) return Promise.resolve(true)
    const id = accountId()
    const next = new Set(marked.value)
    for (const x of done) next.add(x)
    for (const x of undone) next.delete(x)
    marked.value = next
    pending++

    const run = queue.then(async () => {
      try {
        const { done: answer } = await marks.write(id, { done: [...done], undone: [...undone] })
        if (pending === 1 && id === accountId()) marked.value = new Set(answer)
        return true
      } catch (cause) {
        feedback.error(marks.notSaved(), cause)
        if (id === accountId()) await load(id)
        return false
      } finally {
        pending--
      }
    })
    queue = run
    return run
  }

  // Changed elsewhere: re-read once the page is visible and no popover or tip holds updates.
  let stale = false
  function catchUp() {
    if (!stale || updatesHeld.value || document.visibilityState !== 'visible') return
    stale = false
    void load(accountId())
  }
  if (!readOnly) {
    const stopListening = onPlannerChange((changed) => {
      if (changed !== accountId()) return
      stale = true
      catchUp()
    })
    const stopWatching = watch(updatesHeld, catchUp)
    document.addEventListener('visibilitychange', catchUp)
    onScopeDispose(() => {
      stopListening()
      stopWatching()
      document.removeEventListener('visibilitychange', catchUp)
    })
  }

  return { marked, loadedFor, error, reload: () => load(accountId()), change }
}
