import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { api } from '@/api'
import { decodeWishHistory, type WishHistory } from '@/data/wish-history'
import { useResource } from '@/data/use-resource'
import { updatesHeld } from '@/live/holds'
import { onWishChange } from '@/live/wish-changes'

/**
 * The same promise for the same account until the history changes, so a
 * page opened again shows it on its first frame (useResource `settled`).
 * The browser revalidates the response by ETag, so a re-read after an
 * event costs a 304 when nothing moved.
 */
const cache = new Map<number, Promise<{ id: number; history: WishHistory }>>()

/** Tagged with the account, so a switch shows a skeleton, not the last one's pulls. */
function loadWishHistory(accountId: number): Promise<{ id: number; history: WishHistory }> {
  let promise = cache.get(accountId)
  if (!promise) {
    promise = api
      .wishHistory(accountId)
      .then((response) => ({ id: accountId, history: decodeWishHistory(response) }))
    promise.catch(() => cache.delete(accountId))
    cache.set(accountId, promise)
  }
  return promise
}

/**
 * The account's wish history, re-read after an import here and when the
 * live socket says it changed elsewhere (irminsul's sync): once the page is
 * visible and no popover or tip holds updates.
 */
export function useWishHistory(accountId: () => number) {
  const generation = shallowRef(0)
  const resource = useResource(
    () => [accountId(), generation.value] as const,
    ([id]) => loadWishHistory(id),
  )

  function refresh() {
    cache.delete(accountId())
    generation.value++
  }

  let stale = false
  function catchUp() {
    if (!stale || updatesHeld.value || document.visibilityState !== 'visible') return
    stale = false
    refresh()
  }
  const stopListening = onWishChange((changed) => {
    cache.delete(changed)
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

  const history = computed(() => {
    const value = resource.data.value
    return value && value.id === accountId() ? value.history : undefined
  })
  return { history, error: resource.error, refresh, reload: resource.reload }
}
