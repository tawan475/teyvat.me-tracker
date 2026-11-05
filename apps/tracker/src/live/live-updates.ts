/**
 * Live updates for the signed-in app: pages change as data arrives (an
 * irminsul upload, an import or delete in another tab or on another device)
 * without a reload, for as few requests as possible.
 *
 * - One socket per browser: the tabs elect a leader (leader.ts), which keeps
 *   a WebSocket to `/api/live` (the user's hub, a Durable Object; see
 *   worker/services/live.ts) and relays what it hears to the other tabs. When
 *   the leader closes, the next tab takes over within moments.
 * - An event says which account moved to which version; a tab that does not
 *   hold that version yet re-reads the account list (a 304 when another tab
 *   already did) and the store folds the rows in. Pages load their data keyed
 *   by the version (@/data/account-data), so they refresh by themselves,
 *   keeping filters, pages, scroll and open items.
 * - Every connect opens with a `hello` (each account's version and names), so
 *   pushes missed while there was no socket cost one list read only when
 *   something did change. A socket outlives the access token; the hub closes
 *   it when the session ends (4003: this device or every device was signed
 *   out), and the tab then checks its session with a refresh: over, the app
 *   signs out; still on, it reconnects at once.
 * - Reconnects back off from 1 s to 30 s (then 5 min after ten failures).
 *   While the socket cannot connect, visible tabs read the list every two
 *   minutes between them.
 * - Keep-alive: a ping every five minutes while some tab is visible (none
 *   while all are hidden), and at once when a tab is shown or the network
 *   comes back; no pong within 10 s means a dead socket.
 * - The socket stays open while tabs are hidden: an idle hibernating socket
 *   costs nothing. A hidden tab only notes changes (and keeps what other tabs
 *   read) and applies them when shown, so background tabs do not re-download
 *   data nobody is looking at; it reads only if something it was told about
 *   went unread, or the socket is down.
 * - Data never changes under an open popover or pinned tip (dialogs update
 *   live): see @/live/holds.
 * - "New capture" (a toast, the time in its tooltip) when the open account
 *   (or on the account list, any account) got a newer newest snapshot;
 *   nothing for seen-again captures, backfills or deletes.
 */

import { LIVE_SESSION_ENDED_CLOSE, type AccountResponse, type LiveEvent } from '@gdt/shared'
import { onScopeDispose, watch } from 'vue'
import { useRoute } from 'vue-router'
import { TAB_ID, api, checkSession } from '@/api'
import { noteBookmarks } from '@/api/d1-bookmark'
import { formatDateTime } from '@/lib/format'
import { useAccounts } from '@/stores/accounts'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'
import { setPresence } from './presence'
import { onTabMessage, postToTabs, tabsCanTalk, type TabMessage } from './channel'
import { importingAccounts, onApplyPending, updatesHeld } from './holds'
import { requestLeadership } from './leader'
import { liveSeenAt, noteLiveChange, noteLiveMarks } from './journal'
import { emitPlannerChange } from './planner-changes'
import { emitWishChange } from './wish-changes'
import {
  BURST_WINDOW_MS,
  FALLBACK_AFTER,
  FALLBACK_POLL_MS,
  PING_MS,
  PONG_TIMEOUT_MS,
  captureToShow,
  eventNeedsFetch,
  fetchDelay,
  parseLiveEvent,
  reconnectDelay,
  shouldCatchUp,
  shouldPing,
  type PingReason,
} from './policy'

type Timer = ReturnType<typeof setTimeout> | undefined

/** How long a tab waits for another tab's read before reading itself. */
const SHARED_READ_WAIT_MS = 5_000

/** Runs live updates while a user is signed in; call once, from the signed-in layout. */
export function useLiveUpdates(): void {
  const session = useSession()
  const accounts = useAccounts()
  const feedback = useFeedback()
  const route = useRoute()

  let running = false
  let me: number | null = null
  let leader = false
  let resign: (() => void) | null = null
  const unsubscribe: (() => void)[] = []

  // The socket (the leader's).
  let socket: WebSocket | null = null
  let opened = false
  /** Connects in a row that never opened. */
  let failedConnects = 0
  let lastAttemptAt = 0
  let reconnectTimer: Timer
  let lastPingAt = 0
  let lastPongAt = 0
  let pongTimer: Timer

  // What every tab knows of the socket (the leader's own, or as it said).
  let linkUp = true
  let fallback = false
  let fallbackTimer: Timer
  let tickTimer: ReturnType<typeof setInterval> | undefined

  // Reading the list.
  let readTimer: Timer
  let reading: Promise<void> | null = null
  let readAgain = false
  /** When this tab (or another, as it said) last started a read. */
  let lastReadAt = 0
  /** When the oldest event no read has covered yet arrived. */
  let wantedSince: number | null = null
  const eventTimes: number[] = []

  // Hidden tabs.
  /** When the first event this tab did not read for arrived while hidden. */
  let staleSince: number | null = null
  let stash: { list: AccountResponse[]; etag: string | null } | null = null
  let stashRows: AccountResponse[] = []

  let toastId: number | null = null

  const visible = () => document.visibilityState === 'visible'
  const post = (message: DistributiveOmit<TabMessage, 'userId'>) => {
    if (me !== null) postToTabs({ ...message, userId: me } as TabMessage)
  }

  // --------------------------------------------------------------- applying

  function announce(captures: AccountResponse[]) {
    const param = Number(route.params.accountId)
    const openId = Number.isSafeInteger(param) && param > 0 ? param : null
    const capture = captureToShow(
      captures.filter((a) => !importingAccounts.has(a.id)),
      openId,
    )
    if (!capture?.latest) return
    // One at a time: a newer capture replaces the toast.
    if (toastId !== null) feedback.dismiss(toastId)
    toastId = feedback.toast({
      tone: 'info',
      title: 'New capture',
      hint: `${accounts.displayName(capture)} · ${formatDateTime(capture.latest.takenAt)}`,
    })
  }

  const applyList = (list: AccountResponse[], etag: string | null) =>
    announce(accounts.merge(list, { complete: true, etag }))
  const applyRows = (rows: AccountResponse[]) => announce(accounts.merge(rows))

  // ---------------------------------------------------------- reading the list

  /** Re-reads the account list (a 304 when unchanged) and shares it with the other tabs. */
  function read(): Promise<void> {
    if (reading) {
      readAgain = true
      return reading
    }
    clearTimeout(readTimer)
    readTimer = undefined
    const startedAt = Date.now()
    lastReadAt = startedAt
    wantedSince = null
    post({ type: 'reading', startedAt })
    reading = (async () => {
      try {
        const fresh = await api.accountsSince(accounts.currentEtag())
        if (!running) return
        if (fresh) applyList(fresh.list, fresh.etag)
        post({
          type: 'list',
          startedAt,
          etag: accounts.currentEtag(),
          list: fresh?.list ?? null,
        })
      } catch {
        // Offline or a server problem: the next event, reconnect or slow poll reads again.
      } finally {
        reading = null
        if (readAgain && running) {
          readAgain = false
          requestRead()
        }
      }
    })()
    return reading
  }

  /** A read soon: at once after a quiet spell, else after the gap, one for many events. */
  function requestRead() {
    wantedSince ??= Date.now()
    if (reading) {
      readAgain = true
      return
    }
    if (readTimer !== undefined) return
    // A moment of jitter lets one of several visible tabs read for all.
    const delay = fetchDelay(Date.now(), lastReadAt, eventTimes) + Math.random() * 250
    readTimer = setTimeout(() => {
      readTimer = undefined
      void read()
    }, delay)
  }

  /** A socket event: this tab's own (the leader's) or relayed. */
  function onEvent(event: LiveEvent) {
    if (event.type === 'planner') {
      // Not about the account list: the open Planner re-reads its own data.
      if (event.tab !== TAB_ID) emitPlannerChange(event.accountId)
      return
    }
    if (event.type === 'accounts') {
      // Sharing changed (an invite, a role, a removal): the invitations may have too.
      void accounts.refreshInvitations()
    }
    if (event.type === 'hello') {
      // Journals may have moved while there was no socket: re-read those the
      // hello does not show where this tab holds them.
      noteLiveMarks(
        accounts.list.filter((a) => a.liveSync).map((a) => a.id),
        event.journals,
      )
    }
    if (event.type === 'live') {
      // Live sync: the account's journal moved; its "now" views re-read it
      // (from the batch the event carries, when it does).
      liveSeenAt.set(event.accountId, Date.now())
      noteLiveChange(event.accountId, event.seq, event.batch)
      return
    }
    if (event.type === 'presence') {
      // Capture started, stopped or picked up a command: the pages showing it update.
      setPresence(event.accountId, { presence: event.presence, pending: event.pending })
      return
    }
    if (event.type === 'wishes') {
      // Likewise: an open Wish History page re-reads the history.
      if (event.tab !== TAB_ID) emitWishChange(event.accountId)
      return
    }
    const now = Date.now()
    eventTimes.push(now)
    while (eventTimes.length > 0 && now - eventTimes[0]! >= BURST_WINDOW_MS) eventTimes.shift()
    // This tab's own import re-reads its account when the run ends.
    if (event.type === 'data' && importingAccounts.has(event.accountId)) return
    if (!eventNeedsFetch(event, { knownVersion: accounts.knownVersion, shown: accounts.list })) {
      return
    }
    if (!visible()) {
      staleSince ??= now
      return
    }
    requestRead()
  }

  // ------------------------------------------------------- the socket (leader)

  function lead() {
    if (!running) return
    leader = true
    connect()
  }

  function liveUrl(): string {
    return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/live`
  }

  function connect() {
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
    // Offline: the `online` event connects.
    if (!running || !leader || socket || !navigator.onLine) return
    lastAttemptAt = Date.now()
    let ws: WebSocket
    try {
      ws = new WebSocket(liveUrl())
    } catch {
      failedConnects++
      setLink(false)
      scheduleReconnect()
      return
    }
    socket = ws
    opened = false
    ws.addEventListener('open', () => {
      if (socket !== ws) return
      opened = true
      failedConnects = 0
      lastPongAt = Date.now()
      setLink(true)
      // The `hello` that follows says whether anything was missed.
    })
    ws.addEventListener('message', (message) => {
      if (socket !== ws) return
      if (message.data === 'pong') {
        lastPongAt = Date.now()
        clearTimeout(pongTimer)
        pongTimer = undefined
        return
      }
      const event = parseLiveEvent(message.data)
      if (!event) return
      // Before anything re-reads: its reads must reach a replica with this write.
      noteBookmarks(event)
      post({ type: 'event', event })
      onEvent(event)
    })
    ws.addEventListener('close', (event) => {
      if (socket !== ws) return
      if (event.code === LIVE_SESSION_ENDED_CLOSE) sessionClosed()
      else dropped()
    })
  }

  /**
   * The hub closed the socket because its session ended. A refresh tells
   * whether this device's did: over, the signed-out handler stops all this;
   * still on (another device changed the password, say), reconnect now.
   */
  function sessionClosed() {
    socket = null
    opened = false
    clearTimeout(pongTimer)
    pongTimer = undefined
    setLink(false)
    void checkSession().then((alive) => {
      if (alive && running) connect()
    })
  }

  /**
   * The socket is gone (closed, refused, or silent). Reconnect; a first
   * refusal reads the list on the way, which renews an expired access cookie
   * (a socket outlives it) or ends a session that is over.
   */
  function dropped() {
    const ws = socket
    const wasOpen = opened
    socket = null
    opened = false
    clearTimeout(pongTimer)
    pongTimer = undefined
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      try {
        ws.close()
      } catch {
        // Already closing.
      }
    }
    if (!running) return
    if (!wasOpen) failedConnects++
    setLink(false)
    if (!wasOpen && failedConnects === 1) void read().finally(scheduleReconnect)
    else scheduleReconnect()
  }

  function scheduleReconnect() {
    if (!running || !leader || socket || reconnectTimer !== undefined) return
    // Failing while nobody looks: wait for a tab to be shown (it nudges).
    if (failedConnects >= FALLBACK_AFTER && !visible()) return
    reconnectTimer = setTimeout(
      () => {
        reconnectTimer = undefined
        connect()
      },
      reconnectDelay(Math.max(1, failedConnects)),
    )
  }

  function ping() {
    const ws = socket
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send('ping')
    } catch {
      return
    }
    lastPingAt = Date.now()
    clearTimeout(pongTimer)
    pongTimer = setTimeout(() => {
      pongTimer = undefined
      if (socket === ws) dropped()
    }, PONG_TIMEOUT_MS)
  }

  /** A tab was shown, the beat while some tab is visible, or the network is back. */
  function onNudge(reason: PingReason) {
    if (!leader || !running) return
    if (!socket) {
      // Down: try now (a beat only once the backoff would have).
      const due = reason !== 'tick' || Date.now() - lastAttemptAt >= reconnectDelay(failedConnects)
      if (due) connect()
      return
    }
    if (!opened) return
    const now = Date.now()
    if (shouldPing(reason, { now, lastPingAt, lastPongAt, waiting: pongTimer !== undefined })) {
      ping()
    }
  }

  /** Every tab: a nudge for the leader (itself, or by message). */
  function nudge(reason: Exclude<PingReason, 'online'>) {
    if (leader) onNudge(reason)
    else post({ type: 'nudge', reason })
  }

  // ------------------------------------------------------------ link state

  /** The leader's socket went up or down: tell the tabs, poll slowly if it keeps failing. */
  function setLink(up: boolean) {
    const slow = !up && failedConnects >= FALLBACK_AFTER
    const changed = up !== linkUp || slow !== fallback
    adoptLink(up, slow)
    if (changed) post({ type: 'link', up, fallback: slow })
  }

  function adoptLink(up: boolean, slow: boolean) {
    linkUp = up
    if (slow === fallback) return
    fallback = slow
    clearTimeout(fallbackTimer)
    if (slow) scheduleFallback()
  }

  function scheduleFallback() {
    clearTimeout(fallbackTimer)
    if (!fallback || !running) return
    fallbackTimer = setTimeout(
      () => {
        // One tab reads for all: unless another visible one did lately.
        if (visible() && Date.now() - lastReadAt >= FALLBACK_POLL_MS * 0.9) void read()
        scheduleFallback()
      },
      FALLBACK_POLL_MS * (0.9 + Math.random() * 0.2),
    )
  }

  // ------------------------------------------------------------ page events

  function startTick() {
    if (tickTimer !== undefined) return
    tickTimer = setInterval(() => nudge('tick'), PING_MS)
  }

  function stopTick() {
    clearInterval(tickTimer)
    tickTimer = undefined
  }

  function onVisibility() {
    if (!visible()) {
      stopTick()
      return
    }
    if (stash) {
      const { list, etag } = stash
      stash = null
      applyList(list, etag)
    }
    if (stashRows.length > 0) {
      const rows = stashRows
      stashRows = []
      applyRows(rows)
    }
    const catchUp = shouldCatchUp({ linkUp, staleSince, lastReadAt })
    staleSince = null
    if (catchUp) void read()
    startTick()
    // Is the socket still there? (Reconnects at once if it is down.)
    nudge('shown')
  }

  function onOnline() {
    if (leader) {
      failedConnects = Math.min(failedConnects, 1)
      onNudge('online')
    }
  }

  function onMessage(message: TabMessage) {
    if (!running) {
      // Stopped by another tab's sign-out: a tab signing in again (it asks
      // for the link) brings this one back.
      if (
        message.type === 'link?' &&
        session.status === 'signed-in' &&
        message.userId === session.me?.id
      ) {
        start()
      }
      return
    }
    if (message.userId !== me) return
    switch (message.type) {
      case 'event':
        onEvent(message.event)
        return
      case 'link':
        if (!leader) adoptLink(message.up, message.fallback)
        return
      case 'link?':
        if (leader) post({ type: 'link', up: linkUp, fallback })
        return
      case 'nudge':
        onNudge(message.reason)
        return
      case 'bye':
        // This browser signed out in another tab: its cookies are gone.
        stop()
        return
      case 'rows':
        if (visible()) applyRows(message.rows)
        else stashRows.push(...message.rows)
        return
    }
    lastReadAt = Math.max(lastReadAt, message.startedAt)
    // That read began after the events this tab wanted one for, so it covers them.
    const covers =
      readTimer !== undefined && wantedSince !== null && message.startedAt >= wantedSince
    if (message.type === 'reading') {
      // Wait for its answer; read anyway if none comes.
      if (covers) {
        clearTimeout(readTimer)
        readTimer = setTimeout(() => {
          readTimer = undefined
          void read()
        }, SHARED_READ_WAIT_MS)
      }
      return
    }
    if (covers) {
      clearTimeout(readTimer)
      readTimer = undefined
      wantedSince = null
    }
    if (message.list) {
      if (visible()) applyList(message.list, message.etag)
      else stash = { list: message.list, etag: message.etag }
    }
  }

  // -------------------------------------------------------------- lifecycle

  function start() {
    if (running) return
    running = true
    me = session.me?.id ?? null
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    unsubscribe.push(
      // A dialog's "Refresh": apply what waits, dialogs or not.
      onApplyPending(() => announce(accounts.applyPending(true))),
    )
    if (visible()) startTick()
    // Followers learn the socket's state from the leader.
    post({ type: 'link?' })
    resign = requestLeadership(`gdt-live:${me}`, lead, !tabsCanTalk())
  }

  function stop() {
    if (!running) return
    running = false
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('online', onOnline)
    while (unsubscribe.length > 0) unsubscribe.pop()!()
    clearTimeout(reconnectTimer)
    clearTimeout(readTimer)
    clearTimeout(pongTimer)
    clearTimeout(fallbackTimer)
    reconnectTimer = readTimer = pongTimer = fallbackTimer = undefined
    stopTick()
    const ws = socket
    socket = null
    opened = false
    try {
      ws?.close(1000, 'signed out')
    } catch {
      // Already closing.
    }
    // Hands the socket to the next tab (or leaves the queue for it).
    resign?.()
    resign = null
    leader = false
    failedConnects = 0
    linkUp = true
    fallback = false
    staleSince = null
    stash = null
    stashRows = []
    wantedSince = null
  }

  // Listens while mounted, running or not (see onMessage).
  const unlisten = onTabMessage(onMessage)

  watch(
    () => session.status === 'signed-in',
    (signedIn) => {
      if (signedIn) return start()
      // Signed out (here, or the session ended): the other tabs let go too.
      const who = me
      stop()
      if (who !== null) postToTabs({ type: 'bye', userId: who })
    },
    { immediate: true },
  )

  // A dialog closed or this tab's import ended: what waited applies now. An
  // import's own account is re-read by its queue, which says how it went.
  let importing = new Set(importingAccounts)
  watch(
    () => [updatesHeld.value, importingAccounts.size] as const,
    () => {
      const finished = [...importing].filter((id) => !importingAccounts.has(id))
      importing = new Set(importingAccounts)
      if (!running) return
      announce(accounts.applyPending().filter((a) => !finished.includes(a.id)))
    },
  )

  onScopeDispose(() => {
    unlisten()
    stop()
  })
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
