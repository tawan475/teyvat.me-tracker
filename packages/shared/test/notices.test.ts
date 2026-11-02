import { describe, expect, it } from 'vitest'
import {
  bannerAbundance,
  mergeDomainWindows,
  noticeKind,
  noticeShortTitle,
  noticeTag,
  plannerNotice,
  noticeText,
  noticeWindow,
  overflowingPost,
  versionUpdateTime,
  type DomainEventWindow,
  type WindowContext,
} from '../src'

// Text shaped like the game's notices (written for these tests, every format the board uses).
const v71 = { version: '7.1', updateUtc8: '2026-09-23T06:00' }
const asia: WindowContext = { server: 'ASIA', versions: [v71], versionEnd: '2026-11-03T15:00' }
const america: WindowContext = { ...asia, server: 'AMERICA' }

describe('notice text', () => {
  it('drops tags and entities, and folds every space', () => {
    expect(noticeText('<p>〓Event&nbsp;Duration〓</p><p>2026/09/30&#160;10:00 &amp; on</p>')).toBe(
      '〓Event Duration〓 2026/09/30 10:00 & on',
    )
  })

  it('finds the version update time', () => {
    expect(
      versionUpdateTime('〓Reset Details〓 Version 7.1 Update Time:  2026/09/23 06:00 ※'),
    ).toEqual(v71)
    expect(versionUpdateTime('No time here')).toBeNull()
  })
})

describe('notice windows', () => {
  const read = (text: string, context = asia) => noticeWindow(noticeText(text), context)

  it('reads a range, its end exclusive', () => {
    expect(
      read(
        'Event Duration: 2026/09/30 10:00 - 2026/11/03 03:59 Disturbance Outbreak: 2026/09/30 10:00 - 2026/10/10 03:59',
      ),
    ).toEqual({
      start: '2026-09-30T10:00',
      end: '2026-11-03T04:00',
    })
    expect(
      read('Promotional Character (5-Star) 2026/10/13 18:00 – 2026/11/03 14:59 "Void Star"'),
    ).toEqual({
      start: '2026-10-13T18:00',
      end: '2026-11-03T15:00',
    })
    expect(read('2026/10/10 10:00 — 2026/10/26 03:59')).toEqual({
      start: '2026-10-10T10:00',
      end: '2026-10-26T04:00',
    })
  })

  it('starts "after the Version update" at that server’s update time', () => {
    const text = 'After the Version 7.1 update – 2026/11/02 03:59 〓Eligibility〓'
    expect(read(text)).toEqual({ start: '2026-09-23T06:00', end: '2026-11-02T04:00' })
    // America is 13 hours behind UTC+8.
    expect(read(text, america)).toEqual({ start: '2026-09-22T17:00', end: '2026-11-02T04:00' })
    expect(read('After Version 7.1 Update – 2026/11/03 04:00')).toEqual({
      start: '2026-09-23T06:00',
      end: '2026-11-03T04:00',
    })
    // A version whose update time no notice gives: when the board first showed it, else unknown.
    expect(read('After the Version 7.0 update – 2026/11/03 14:59')).toBeNull()
    expect(
      read('After the Version 7.0 update – 2026/11/03 14:59', {
        ...asia,
        shownFrom: '2026-08-10T05:00',
      }),
    ).toEqual({ start: '2026-08-10T05:00', end: '2026-11-03T15:00' })
  })

  it('reads the version-long and open-ended ones', () => {
    expect(read('2026/09/28 00:00 until the end of Version 7.1 Eligibility')).toEqual({
      start: '2026-09-28T00:00',
      end: '2026-11-03T15:00',
    })
    expect(read('Available throughout the entirety of Version 7.1 〓Eligibility〓')).toEqual({
      start: '2026-09-23T06:00',
      end: '2026-11-03T15:00',
    })
    expect(read('Permanently available after the Version 7.1 update It will take 7 days')).toEqual({
      start: '2026-09-23T06:00',
      end: null,
    })
  })

  it('takes the first window in the text, and none when there is none', () => {
    expect(
      read(
        'Preparation Phase: After the Version 7.1 update – 2026/09/24 09:59 Play Phase: 2026/09/24 10:00 – 2026/11/03 03:59',
      ),
    ).toEqual({
      start: '2026-09-23T06:00',
      end: '2026-09-24T10:00',
    })
    expect(read('Dear Travelers, a new adventure has begun!')).toBeNull()
    expect(read('2026/02/30 10:00 - 2026/03/03 03:59')).toBeNull()
  })
})

describe('which notices count', () => {
  it('keeps wishes and events, not news or top-ups', () => {
    expect(
      noticeKind({
        annId: 1,
        typeLabel: 'Event',
        title: 'Event Wish "Void Star\'s Advent" - Boosted Drop Rate',
      }),
    ).toBe('wish')
    expect(
      noticeKind({
        annId: 2,
        typeLabel: 'Event',
        title: 'Stygian Onslaught Event: Disturbance-affected Ley Line challenges',
      }),
    ).toBe('event')
    expect(
      noticeKind({ annId: 3, typeLabel: 'Game', title: 'Version 7.1 Update Details' }),
    ).toBeNull()
    expect(
      noticeKind({
        annId: 4,
        typeLabel: 'Event',
        title: 'Genshin Impact - Initial Top-Up Bonus Reset',
      }),
    ).toBeNull()
    expect(
      noticeKind({ annId: 5, typeLabel: 'Miliastra Wonderland', title: 'Starlit Gala' }),
    ).toBeNull()
  })

  it('shortens a title to its quoted name', () => {
    expect(noticeShortTitle('"Moontrace" Event Details')).toBe('Moontrace')
    expect(noticeShortTitle('Stygian Onslaught Event: Disturbance')).toBe(
      'Stygian Onslaught Event: Disturbance',
    )
    expect(noticeShortTitle('「月迹」活动说明')).toBe('月迹')
  })
})

describe('domain events', () => {
  it("opens every domain for 7 days from a version's first banners, not its second phase", () => {
    const phase2 = { start: '2026-10-13T18:00', end: '2026-11-03T15:00' }
    expect(
      bannerAbundance(
        [phase2, { ...phase2 }, { start: '2026-09-23T06:00', end: '2026-10-13T15:00' }],
        '7.1',
      ),
    ).toEqual([
      expect.objectContaining({
        kind: 'abundance',
        start: '2026-09-23T06:00',
        end: '2026-09-30T04:00',
        source: 'banner',
        version: '7.1',
      }),
    ])
  })

  it('opens a next version early on the board only once the running banners end', () => {
    const running = { start: '2026-10-13T18:00', end: '2026-11-03T15:00' }
    const next = { start: '2026-11-02T12:00', end: '2026-11-24T18:00' }
    expect(bannerAbundance([running, next, { ...next }])).toEqual([
      expect.objectContaining({ start: '2026-11-03T15:00', end: '2026-11-10T04:00' }),
    ])
  })

  it('reads an official HoYoLAB post', () => {
    const post = overflowingPost(
      '"Overflowing Abundance" Event: Double Drops With Talent Level-Up Materials',
      'During the event, double your rewards up to 3 times a day! 〓Event Duration〓 2026/09/14 04:00 - 2026/09/21 03:59',
    )
    expect(post).toEqual({
      kind: 'abundance',
      start: '2026-09-14T04:00',
      end: '2026-09-21T04:00',
      multiplier: 2,
      dailyClaims: 3,
      version: '',
      source: 'hoyolab',
    })
    expect(
      overflowingPost('Version 7.1 livestream', '2026/09/14 04:00 - 2026/09/21 03:59'),
    ).toBeNull()
  })

  it('an announced run wins over the banner rule; copies of a run go', () => {
    const run = (over: Partial<DomainEventWindow>): DomainEventWindow => ({
      kind: 'abundance',
      start: '2026-10-13T06:00',
      end: '2026-10-20T04:00',
      multiplier: 2,
      dailyClaims: 3,
      version: '',
      source: 'staff',
      ...over,
    })
    const banner = bannerAbundance([{ start: '2026-10-13T06:00', end: '2026-11-03T15:00' }])
    expect(mergeDomainWindows([run({})], banner)).toEqual([run({})])
    const favor = run({ kind: 'favor', start: '2026-10-26T04:00', end: '2026-11-02T04:00' })
    expect(mergeDomainWindows([favor, favor], banner).map((w) => [w.kind, w.source])).toEqual([
      ['abundance', 'banner'],
      ['favor', 'staff'],
    ])
  })
})

describe('the board’s time marks', () => {
  it('keeps server-local times and moves global (UTC+8) ones to the server', () => {
    const html =
      'Event Duration: &lt;t class="t_gl" contenteditable="false"&gt;2026/10/12 10:00&lt;/t&gt; – ' +
      '&lt;t class="t_gl"&gt;2026/10/20 09:59&lt;/t&gt; Banner: <t class="t_lc">2026/10/13 18:00</t>'
    expect(noticeText(html, 'ASIA')).toBe(
      'Event Duration: 2026/10/12 10:00 – 2026/10/20 09:59 Banner: 2026/10/13 18:00',
    )
    // America is 13 hours behind UTC+8; its local banner time stays.
    expect(noticeText(html, 'AMERICA')).toBe(
      'Event Duration: 2026/10/11 21:00 – 2026/10/19 20:59 Banner: 2026/10/13 18:00',
    )
  })
})

describe('what the planner lists (Seelie’s choice)', () => {
  it('leaves out permanent quests, game modes and tracks; tags the rest', () => {
    const keep = (title: string, end: string | null = '2026-11-03T15:00') =>
      plannerNotice({ title, end })
    expect(keep('"Predictive Victory Dynamics" Event: Predict the Outcome of Battles')).toBe(true)
    expect(keep('"Rainbow’s End: Resplendent Starlight" Event: Log In to Claim Primogems')).toBe(
      true,
    )
    expect(keep('"Swords and Secrets" World Quest Overview', null)).toBe(false)
    expect(keep('"Genius Invokation TCG" Heated Battle Mode: Automatic Artistry')).toBe(false)
    expect(keep('Stygian Onslaught Event: Disturbance-affected Ley Line challenges')).toBe(false)
    expect(keep('"Moontrace" Event Details')).toBe(false)
    expect(keep('"To Temper Thyself and Journey Far": Rewards of Dedication')).toBe(false)
    expect(
      noticeTag('"Rainbow’s End: Resplendent Starlight" Event: Log In to Claim Primogems'),
    ).toBe('checkin')
    expect(noticeTag('"The Godforsaken Frostlands" Event: Complete Exploration Missions')).toBe(
      'exploration',
    )
    expect(
      noticeTag(
        'Complete the Archon Quest "A Rekviem for the Underworld" Within the Specified Duration',
      ),
    ).toBe('quest')
    expect(
      noticeTag('"Tabletop Troupe: A Gathering on Adventure’s Eve" Event: Invite a Character'),
    ).toBeNull()
  })
})
