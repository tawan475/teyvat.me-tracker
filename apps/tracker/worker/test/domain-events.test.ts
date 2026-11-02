import type { DomainEventsResponse, GameEventsResponse } from '@gdt/shared'
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { lastEventsSync, syncGameEvents } from '../services/game-events'
import { ORIGIN } from './client'

// Synthetic answers shaped like the notice board's and HoYoLAB's (the texts written for these tests).
const day = (offset: number) =>
  `${new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '/')}`

function boardList() {
  return {
    retcode: 0,
    data: {
      timezone: 8,
      list: [
        {
          list: [
            {
              ann_id: 9001,
              title: 'Event Wish "Test Banner" - Boosted Drop Rate',
              type_label: 'Event',
              start_time: '2026-01-01 05:00:00',
              banner: 'https://example.org/wish.png',
            },
            {
              ann_id: 9002,
              title: '"Moon Hunt" Event Details',
              type_label: 'Event',
              start_time: '2026-01-01 05:00:00',
              banner: '',
            },
            {
              ann_id: 9003,
              title: 'Genshin Impact - Initial Top-Up Bonus Reset',
              type_label: 'Event',
              start_time: '2026-01-01 05:00:00',
            },
            {
              ann_id: 9004,
              title: 'Version Details',
              type_label: 'Game',
              start_time: '2026-01-01 05:00:00',
            },
            {
              ann_id: 9005,
              title: '"No Dates" Event',
              type_label: 'Event',
              start_time: '2026-01-01 05:00:00',
            },
          ],
        },
      ],
    },
  }
}

function boardContent(lang: string) {
  const zh = lang.startsWith('zh')
  // The other languages: a title of their own for the wish, English for the rest.
  const wishTitle = zh
    ? '「测试」祈愿'
    : lang === 'en'
      ? 'Event Wish "Test Banner" - Boosted Drop Rate'
      : `Wish (${lang})`
  return {
    retcode: 0,
    data: {
      list: [
        {
          ann_id: 9001,
          title: wishTitle,
          content: `<p>Promotional Character</p><p>&lt;t class="t_lc"&gt;${day(-1)} 18:00&lt;/t&gt; – &lt;t class="t_lc"&gt;${day(20)} 14:59&lt;/t&gt;</p>`,
        },
        {
          ann_id: 9002,
          title: zh ? '「月猎」活动说明' : '"Moon Hunt" Event Details',
          content: `〓Event Duration〓 <t class="t_gl">${day(-3)} 10:00</t> - <t class="t_gl">${day(10)} 03:59</t>`,
        },
        {
          ann_id: 9003,
          title: 'Initial Top-Up',
          content: 'Version 9.9 Update Time: 2026/01/01 06:00',
        },
        { ann_id: 9005, title: '"No Dates" Event', content: 'Soon, somewhere.' },
      ],
    },
  }
}

function hoyolab() {
  return {
    retcode: 0,
    data: {
      list: [
        {
          post: {
            post_id: '777',
            uid: '1015537',
            subject: '"<hoyolab>Overflowing</hoyolab> Favor" Event: Double Drops',
            content: `double your rewards up to 3 times a day 〓Event Duration〓 ${day(5)} 04:00 - ${day(12)} 03:59`,
          },
        },
        {
          post: {
            post_id: '778',
            uid: '42',
            subject: '"Overflowing Mastery" fan post',
            content: `${day(1)} 04:00 - ${day(8)} 03:59`,
          },
        },
      ],
    },
  }
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
/** Every URL the fake was asked, for the last sync. */
let asked: string[] = []
const fake =
  (fail: (url: string) => boolean = () => false) =>
  async (url: string) => {
    asked.push(url)
    if (fail(url)) return new Response('no', { status: 503 })
    if (url.includes('hoyolab')) return json(hoyolab())
    if (url.includes('getAnnList')) return json(boardList())
    return json(boardContent(/lang=([a-z-]+)/.exec(url)![1]!))
  }

describe('the game events sync', () => {
  it('reads every server, serves the events and the banner week, and keeps rows when a source fails', async () => {
    asked = []
    const status = await syncGameEvents(env.DB, Date.now(), fake())
    expect(status.ok).toBe(true)
    // The other languages' titles are read once (one server), not per server.
    expect(asked.filter((url) => url.includes('lang=ja'))).toHaveLength(1)
    expect(asked.filter((url) => url.includes('lang=zh-cn'))).toHaveLength(4)
    expect(status.counts).toMatchObject({ 'board:ASIA': 2, 'board:AMERICA': 2, hoyolab: 1 })
    expect(status.unparsed).toEqual(expect.arrayContaining([expect.stringContaining('9005')]))
    expect((await lastEventsSync(env.DB))?.at).toBe(status.at)

    // Unchanged lists within a day: only the lists and the search are read, the rows stay.
    asked = []
    const again = await syncGameEvents(env.DB, status.at + 3_600_000, fake())
    expect(asked).toHaveLength(5)
    expect(again.fullAt).toBe(status.fullAt)
    expect(again.counts).toEqual(status.counts)
    expect((await lastEventsSync(env.DB))?.at).toBe(again.at)
    // A day later the contents are read in full again.
    asked = []
    const daily = await syncGameEvents(env.DB, status.at + 25 * 3_600_000, fake())
    expect(asked.length).toBeGreaterThan(5)
    expect(daily.fullAt).toBe(daily.at)

    const asia = (await (
      await SELF.fetch(`${ORIGIN}/api/game-events?server=ASIA`)
    ).json()) as GameEventsResponse
    expect(asia.notices.map((n) => [n.id, n.kind])).toEqual([
      ['board:9002', 'event'],
      ['board:9001', 'wish'],
    ])
    expect(asia.notices[1]!.title).toEqual({
      en: 'Event Wish "Test Banner" - Boosted Drop Rate',
      'zh-CN': '「测试」祈愿',
      'zh-TW': '「测试」祈愿',
      ...Object.fromEntries(
        ['ja', 'ko', 'es', 'fr', 'ru', 'th', 'vi', 'de', 'id', 'pt', 'it', 'tr'].map((lang) => [
          lang,
          `Wish (${lang})`,
        ]),
      ),
    })
    const local = (offset: number, time: string) => `${day(offset).replace(/\//g, '-')}T${time}`
    // The banner phase opens every domain for 7 days; the official post's Favor is listed, the fan's Mastery not.
    expect(asia.domain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'abundance',
          start: local(-1, '18:00'),
          end: local(6, '04:00'),
          source: 'banner',
        }),
        expect.objectContaining({
          kind: 'favor',
          start: local(5, '04:00'),
          end: local(12, '04:00'),
          source: 'hoyolab',
        }),
      ]),
    )
    expect(asia.domain.some((w) => w.kind === 'mastery')).toBe(false)

    // A global (UTC+8) time is that server's local one: America starts the web event 13 hours earlier.
    const america = (await (
      await SELF.fetch(`${ORIGIN}/api/game-events?server=AMERICA`)
    ).json()) as GameEventsResponse
    expect(america.notices.find((n) => n.id === 'board:9002')!.start).toBe(local(-4, '21:00'))

    // The old route answers the same domain windows.
    const old = (await (
      await SELF.fetch(`${ORIGIN}/api/domain-events`)
    ).json()) as DomainEventsResponse
    expect(old.events).toEqual(asia.domain)

    // Everything down: an error each, nothing lost.
    const failed = await syncGameEvents(
      env.DB,
      Date.now(),
      fake(() => true),
    )
    expect(failed.ok).toBe(false)
    expect(failed.errors).toHaveLength(5)
    const after = (await (
      await SELF.fetch(`${ORIGIN}/api/game-events?server=ASIA`)
    ).json()) as GameEventsResponse
    expect(after.notices).toHaveLength(2)
    expect(after.syncedAt).toBe(failed.at)
  })
})
