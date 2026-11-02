/**
 * The game's events, read every hour (docs/plans/game-events.md): the public
 * notice board per server (Events and Event Wishes, dates from the notices'
 * text) and the official HoYoLAB posts announcing an Overflowing event, kept
 * in `game_notices` (migration 0025). Then served, merged with the game
 * data's domain events, staff's windows and the banner rule
 * (`GET /api/game-events`).
 *
 * A failed fetch keeps what is stored: nothing is deleted because a source
 * did not answer; a row goes a week after it ends. The sync's outcome is in
 * site_settings `events.sync` for the staff page.
 */

import {
  NOTICE_REGIONS,
  NOTICE_SERVER_OFFSETS,
  addMinutes,
  bannerAbundance,
  mergeDomainWindows,
  noticeKind,
  noticeTag,
  plannerNotice,
  noticeText,
  noticeWindow,
  overflowingPost,
  versionUpdateTime,
  type DomainEventWindow,
  type EventsSyncStatus,
  type GameEventsResponse,
  type GameNotice,
  type SiteLanguage,
  type NoticeKind,
  type NoticeServer,
  type NoticeWindow,
  type VersionTimes,
} from '@gdt/shared'
import { loadDomainEvents } from '@gdt/game-data/events'
import { staffDomainEvents } from './staff-deps'

const BOARD = 'https://sg-hk4e-api.hoyoverse.com/common/hk4e_global/announcement/api'
const BOARD_QUERY =
  'game=hk4e&game_biz=hk4e_global&bundle_id=hk4e_global&platform=pc&level=55&uid=100000000'
/** The board's language codes, and ours: read for every server. */
const LANGUAGES = [
  ['en', 'en'],
  ['zh-cn', 'zh-CN'],
  ['zh-tw', 'zh-TW'],
] as const
/**
 * The site's other languages (the board's codes are ours): only titles come
 * from them, and every server's board has the same notices under the same
 * ids, so they are read from one server and shared (12 requests, not 48:
 * a sync stays far below the Worker's subrequest limit).
 */
const TITLE_LANGUAGES = [
  'ja',
  'ko',
  'es',
  'fr',
  'ru',
  'th',
  'vi',
  'de',
  'id',
  'pt',
  'it',
  'tr',
] as const satisfies readonly SiteLanguage[]
const TITLE_REGION = 'os_asia'
const HOYOLAB_SEARCH =
  'https://bbs-api-os.hoyolab.com/community/search/wapi/search/post?keyword=Overflowing&gids=2&size=20&preview=true&page_num=1'
/** HoYoLAB's official Genshin Impact account: only its posts count. */
const OFFICIAL_UID = '1015537'
const SERVERS = Object.keys(NOTICE_REGIONS) as NoticeServer[]

export const EVENTS_SYNC_KEY = 'events.sync'
/** Notices starting within this long are listed (as Seelie's Events tab). */
const LEAD_MS = 14 * 86_400_000
/** The contents are read in full at least this often, even when the lists look the same. */
const FULL_EVERY_MS = 24 * 3_600_000
/** Rows stay this long after they end. */
const KEEP_MS = 7 * 86_400_000
const TIMEOUT_MS = 15_000

export interface NoticeRow {
  server: NoticeServer
  source: 'board' | 'hoyolab'
  annId: number
  kind: string
  start: string
  end: string | null
  titles: Record<string, string>
  image: string | null
}

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

async function getData(fetcher: Fetcher, url: string): Promise<Record<string, unknown>> {
  const response = await fetcher(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json', 'x-rpc-language': 'en-us' },
  })
  if (!response.ok) throw new Error(`${url.split('?')[0]} answered ${response.status}`)
  const body = (await response.json()) as { retcode?: number; message?: string; data?: unknown }
  if (body.retcode !== 0 || typeof body.data !== 'object' || body.data === null) {
    throw new Error(`${url.split('?')[0]}: retcode ${body.retcode} ${body.message ?? ''}`.trim())
  }
  return body.data as Record<string, unknown>
}

interface BoardListItem {
  ann_id: number
  title: string
  type_label: string
  start_time: string
  banner?: string
}

const listItems = (list: Record<string, unknown>): BoardListItem[] =>
  ((list.list as { list?: BoardListItem[] }[] | undefined) ?? []).flatMap(
    (group) => group.list ?? [],
  )

const contentItems = (content: Record<string, unknown> | undefined) =>
  new Map(
    ((content?.list as { ann_id: number; title: string; content: string }[] | undefined) ?? []).map(
      (item) => [item.ann_id, item],
    ),
  )

/**
 * One server's board as rows (pure): its Events and Event Wishes with the
 * dates their English text states, titles in every language read; the
 * notices that are events but whose dates did not read.
 */
export function boardRows(
  server: NoticeServer,
  list: Record<string, unknown>,
  contents: Partial<Record<SiteLanguage, Record<string, unknown>>>,
): { rows: NoticeRow[]; unparsed: string[] } {
  const items = listItems(list)
  const english = contentItems(contents.en)
  const translated = (Object.keys(contents) as SiteLanguage[])
    .filter((lang) => lang !== 'en')
    .map((lang) => [lang, contentItems(contents[lang])] as const)
  const boardZone = typeof list.timezone === 'number' ? list.timezone : 8
  const texts = new Map(
    [...english].map(([id, item]) => [id, noticeText(item.content ?? '', server)]),
  )
  const versions: VersionTimes[] = [...texts.values()].flatMap(
    (text) => versionUpdateTime(text) ?? [],
  )
  const wishes: NoticeWindow[] = []
  for (const item of items) {
    if (
      noticeKind({ annId: item.ann_id, typeLabel: item.type_label, title: item.title }) !== 'wish'
    )
      continue
    const window = noticeWindow(texts.get(item.ann_id) ?? '', { server, versions })
    if (window) wishes.push(window)
  }
  const versionEnd =
    wishes
      .flatMap((w) => (w.end ? [w.end] : []))
      .sort()
      .at(-1) ?? null

  const rows: NoticeRow[] = []
  const unparsed: string[] = []
  for (const item of items) {
    const kind = noticeKind({ annId: item.ann_id, typeLabel: item.type_label, title: item.title })
    if (!kind) continue
    // The board's own times (when the notice shows) are in its zone (UTC+8).
    const shown = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(item.start_time ?? '')
    const shownFrom = shown
      ? addMinutes(`${shown[1]}T${shown[2]}`, (NOTICE_SERVER_OFFSETS[server] - boardZone) * 60)
      : null
    const window = noticeWindow(texts.get(item.ann_id) ?? '', {
      server,
      versions,
      versionEnd,
      shownFrom,
    })
    if (!window) {
      unparsed.push(`${server}:${item.ann_id} ${item.title.slice(0, 60)}`)
      continue
    }
    const titles: Record<string, string> = { en: english.get(item.ann_id)?.title ?? item.title }
    for (const [lang, items] of translated) {
      const title = items.get(item.ann_id)?.title
      if (title) titles[lang] = title
    }
    rows.push({
      server,
      source: 'board',
      annId: item.ann_id,
      kind,
      start: window.start,
      end: window.end,
      titles,
      image: item.banner || null,
    })
  }
  return { rows, unparsed }
}

interface HoyolabPost {
  post?: { post_id?: string; uid?: string; subject?: string; content?: string }
}

/** The official posts announcing an Overflowing event, one row per server (pure). */
export function hoyolabRows(data: Record<string, unknown>): NoticeRow[] {
  const posts = (data.list as HoyolabPost[] | undefined) ?? []
  const rows: NoticeRow[] = []
  for (const { post } of posts) {
    if (!post || post.uid !== OFFICIAL_UID || !post.post_id) continue
    const subject = (post.subject ?? '').replace(/<[^>]*>/g, '')
    const window = overflowingPost(subject, post.content ?? '')
    if (!window) continue
    for (const server of SERVERS) {
      rows.push({
        server,
        source: 'hoyolab',
        annId: Number(post.post_id),
        kind: window.kind,
        start: window.start,
        end: window.end,
        titles: { en: subject },
        image: null,
      })
    }
  }
  return rows
}

const settled = <T>(promise: Promise<T>): Promise<T | Error> =>
  promise.catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))))

async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  )
  return [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Reads every source and stores what it found, in one batch. Never throws:
 * a source that failed is in the status's errors, its rows kept. The four
 * lists and the HoYoLAB search are read first (five small requests): when
 * they match the last full read's and that was within a day, the notices'
 * contents (the other 24 requests, and most of the CPU) are not read again
 * and only the status is stored.
 */
export async function syncGameEvents(
  d1: D1Database,
  now = Date.now(),
  fetcher: Fetcher = fetch,
): Promise<EventsSyncStatus> {
  const status: EventsSyncStatus = { at: now, ok: true, counts: {}, unparsed: [], errors: [] }
  const rows: NoticeRow[] = []
  const boardUrl = (region: string, endpoint: string, lang: string) =>
    `${BOARD}/${endpoint}?${BOARD_QUERY}&region=${region}&lang=${lang}`
  const [lists, search, previous] = await Promise.all([
    Promise.all(
      SERVERS.map((server) =>
        settled(getData(fetcher, boardUrl(NOTICE_REGIONS[server], 'getAnnList', 'en'))),
      ),
    ),
    settled(getData(fetcher, HOYOLAB_SEARCH)),
    lastEventsSync(d1),
  ])
  const signature = await digest(
    JSON.stringify([
      lists.map((list) =>
        list instanceof Error
          ? null
          : listItems(list).map((i) => [i.ann_id, i.start_time, i.title, i.type_label, i.banner]),
      ),
      search instanceof Error ? null : search,
    ]),
  )
  const readAll = lists.every((l) => !(l instanceof Error)) && !(search instanceof Error)
  if (
    readAll &&
    previous?.ok &&
    previous.signature === signature &&
    previous.fullAt !== undefined &&
    now - previous.fullAt < FULL_EVERY_MS
  ) {
    const kept: EventsSyncStatus = { ...previous, at: now }
    await d1
      .prepare(
        `INSERT INTO site_settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, NULL)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
           updated_by = NULL`,
      )
      .bind(EVENTS_SYNC_KEY, JSON.stringify(kept), now)
      .run()
    return kept
  }
  status.signature = signature
  status.fullAt = now
  // Titles in the other languages: one server's board, shared; a language that fails is left out.
  const titleContents = Promise.all(
    TITLE_LANGUAGES.map((lang) =>
      getData(fetcher, boardUrl(TITLE_REGION, 'getAnnContent', lang)).then(
        (content) => [lang, content] as const,
        () => null,
      ),
    ),
  ).then((read) => Object.fromEntries(read.filter((entry) => entry !== null)))
  await Promise.all(
    SERVERS.map(async (server, s) => {
      const region = NOTICE_REGIONS[server]
      const url = (endpoint: string, lang: string) => boardUrl(region, endpoint, lang)
      try {
        const list = lists[s]!
        if (list instanceof Error) throw list
        const contents = await Promise.all(
          LANGUAGES.map(([lang]) => getData(fetcher, url('getAnnContent', lang))),
        )
        const byLanguage = {
          ...(await titleContents),
          ...Object.fromEntries(LANGUAGES.map(([, ours], i) => [ours, contents[i]])),
        }
        const read = boardRows(server, list, byLanguage)
        rows.push(...read.rows)
        status.unparsed.push(...read.unparsed)
        status.counts[`board:${server}`] = read.rows.length
      } catch (error) {
        status.ok = false
        status.errors.push(
          `board ${server}: ${String(error instanceof Error ? error.message : error)}`,
        )
      }
    }),
  )
  try {
    if (search instanceof Error) throw search
    const found = hoyolabRows(search)
    rows.push(...found)
    status.counts.hoyolab = found.length / SERVERS.length
  } catch (error) {
    status.ok = false
    status.errors.push(`hoyolab: ${String(error instanceof Error ? error.message : error)}`)
  }

  // A local time compared as text: a day of slack covers every server's zone.
  const gone = new Date(now - KEEP_MS - 86_400_000).toISOString().slice(0, 16)
  await d1.batch([
    ...rows.map((row) =>
      d1
        .prepare(
          `INSERT INTO game_notices (server, source, ann_id, kind, start, "end", titles, image, first_seen_at, last_seen_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
           ON CONFLICT (server, source, ann_id) DO UPDATE SET kind = excluded.kind,
             start = excluded.start, "end" = excluded."end", titles = excluded.titles,
             image = excluded.image, last_seen_at = excluded.last_seen_at`,
        )
        .bind(
          row.server,
          row.source,
          row.annId,
          row.kind,
          row.start,
          row.end,
          JSON.stringify(row.titles),
          row.image,
          now,
        ),
    ),
    d1.prepare(`DELETE FROM game_notices WHERE "end" IS NOT NULL AND "end" < ?1`).bind(gone),
    d1
      .prepare(
        `INSERT INTO site_settings (key, value, updated_at, updated_by) VALUES (?1, ?2, ?3, NULL)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at,
           updated_by = NULL`,
      )
      .bind(EVENTS_SYNC_KEY, JSON.stringify(status), now),
  ])
  return status
}

/** The last sync's outcome, null before the first. */
export async function lastEventsSync(d1: D1Database): Promise<EventsSyncStatus | null> {
  const row = await d1
    .prepare('SELECT value FROM site_settings WHERE key = ?1')
    .bind(EVENTS_SYNC_KEY)
    .first<{ value: string }>()
  if (!row) return null
  try {
    return JSON.parse(row.value) as EventsSyncStatus
  } catch {
    return null
  }
}

// ------------------------------------------------------------- serving

/** A stored row's English title ('' when unreadable). */
function englishTitle(row: { titles: string }): string {
  try {
    return (JSON.parse(row.titles) as { en?: string }).en ?? ''
  } catch {
    return ''
  }
}

/** A server local time as an instant on `server`. */
const instant = (time: string, server: NoticeServer) =>
  Date.parse(`${time}:00Z`) - NOTICE_SERVER_OFFSETS[server] * 3_600_000

interface StoredRow {
  source: 'board' | 'hoyolab'
  ann_id: number
  kind: string
  start: string
  end: string | null
  titles: string
  image: string | null
}

/**
 * What `GET /api/game-events?server=` answers: the domain event windows
 * (game data ∪ staff ∪ HoYoLAB posts, then the banner rule where none of
 * those has a run) and the board's events and wishes running or starting
 * within 14 days.
 */
export async function gameEventsFor(
  d1: D1Database,
  server: NoticeServer,
  now = Date.now(),
): Promise<GameEventsResponse> {
  const [data, staff, stored, sync] = await Promise.all([
    loadDomainEvents().catch(() => [] as DomainEventWindow[]),
    staffDomainEvents(d1),
    d1
      .prepare(
        `SELECT source, ann_id, kind, start, "end", titles, image FROM game_notices WHERE server = ?1`,
      )
      .bind(server)
      .all<StoredRow>(),
    lastEventsSync(d1),
  ])
  const rows = stored.results
  const window = (row: StoredRow): DomainEventWindow => ({
    kind: row.kind as DomainEventWindow['kind'],
    start: row.start,
    end: row.end ?? row.start,
    multiplier: 2,
    dailyClaims: 3,
    version: '',
    source: 'hoyolab',
  })
  const posts = rows.filter((r) => r.source === 'hoyolab' && r.end).map(window)
  const wishes = rows.filter((r) => r.source === 'board' && r.kind === 'wish')
  const banner = bannerAbundance(wishes.map((w) => ({ start: w.start, end: w.end })))
  const domain = mergeDomainWindows([...data, ...staff, ...posts], banner).filter(
    (w) =>
      instant(w.end, server) > now - 86_400_000 && instant(w.start, server) < now + 60 * 86_400_000,
  )

  const notices: GameNotice[] = rows
    .filter((r) => r.source === 'board')
    .filter((r) => r.kind === 'wish' || plannerNotice({ title: englishTitle(r), end: r.end }))
    .filter(
      (r) =>
        (r.end === null || instant(r.end, server) > now) &&
        instant(r.start, server) < now + LEAD_MS,
    )
    .map((r) => {
      let titles: GameNotice['title'] = { en: '' }
      try {
        const parsed = JSON.parse(r.titles) as Partial<GameNotice['title']>
        titles = { ...parsed, en: parsed.en ?? '' }
      } catch {
        // Kept as stored: an empty title shows the id.
      }
      return {
        id: `board:${r.ann_id}`,
        kind: r.kind as NoticeKind,
        start: r.start,
        end: r.end,
        title: titles,
        image: r.image,
        tag: r.kind === 'event' ? noticeTag(titles.en) : null,
      }
    })
    .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))

  return { server, domain, notices, syncedAt: sync?.at ?? null }
}
