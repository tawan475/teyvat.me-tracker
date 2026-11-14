/**
 * The shapes `/api/v1` answers with (docs/plans/public-api.md §4): zod
 * schemas the router parses every answer through (unknown keys are
 * dropped, so a change inside the app can't leak into the public shape) and
 * the docs describe. Times are ISO 8601 UTC; wish ids are strings.
 */

import { API_AREAS, API_BUCKETS, API_TIERS } from '@gdt/shared'
import { z } from 'zod'

const time = z.iso.datetime().describe('ISO 8601, UTC')
const nullableTime = time.nullable()

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50).describe('1–200, default 50'),
  cursor: z.string().max(400).optional().describe('`meta.nextCursor` of the page before'),
})

export const pageMeta = z.object({
  nextCursor: z.string().nullable().describe('null: the last page'),
  limit: z.number().int(),
})

export const summary = z
  .record(z.string(), z.number())
  .describe(
    'Counts at the capture: characters, weapons, artifacts, materials, mora, primogem, artifact3, artifact4…',
  )

export const limits = z.object({
  tier: z.enum(API_TIERS),
  global: z.number().int().describe('Requests a minute, all routes'),
  buckets: z
    .record(z.enum(API_BUCKETS), z.number().int().nullable())
    .describe('Per minute; null: only the global limit'),
})

export const me = z.object({
  id: z.number().int(),
  username: z.string(),
  limits,
  token: z
    .object({
      id: z.string(),
      write: z.array(z.enum(API_AREAS)).describe('Areas it may change; it reads every area'),
      accounts: z.array(z.number().int()).nullable().describe('null: every account'),
    })
    .nullable()
    .describe('null when called with the website session'),
})

export const account = z.object({
  id: z.number().int(),
  name: z.string().nullable(),
  uid: z.string().nullable(),
  server: z.string().nullable(),
  role: z.enum(['owner', 'editor', 'viewer']),
  owner: z.string().nullable().describe("The owner's username on accounts shared with you"),
  createdAt: time,
  version: z.number().int().describe('Moves on every change to the account’s data'),
  snapshotCount: z.number().int(),
  rawBytes: z.number().int(),
  storedBytes: z.number().int(),
  latest: z
    .object({
      snapshotId: z.number().int(),
      takenAt: time,
      lastSeenAt: time,
      source: z.string().nullable(),
      summary,
    })
    .nullable(),
})

export const accountInputDoc = z.object({
  name: z.string().max(64).nullable().optional(),
  uid: z
    .string()
    .regex(/^\d{9,10}$/)
    .nullable()
    .optional(),
  server: z.string().nullable().optional().describe('ASIA, EUROPE, AMERICA, TW_HK_MO, CN…'),
})

export const settings = z
  .record(z.string(), z.unknown())
  .describe('The account settings (traveler, planner options…)')

export const snapshot = z.object({
  id: z.number().int(),
  takenAt: time,
  lastSeenAt: time.describe('The last time the same data was uploaded again'),
  createdAt: time,
  source: z.string(),
  rawBytes: z.number().int(),
  storedBytes: z.number().int(),
  summary,
  capture: z
    .record(z.string(), z.unknown())
    .nullable()
    .describe("Capture's `gi_capture`, when it took it"),
})

export const importResult = z.object({
  status: z.enum(['created', 'unchanged']),
  snapshotId: z.number().int(),
  takenAt: time,
  rawBytes: z.number().int(),
  storedBytes: z.number().int(),
  warnings: z.array(z.record(z.string(), z.unknown())),
})

export const good = z
  .record(z.string(), z.unknown())
  .describe('A GOOD file (version 3) with the `gi_*` keys')

export const compactResult = z.object({
  kept: z.number().int(),
  removed: z.number().int(),
  dryRun: z.boolean(),
})

export const liveJournal = z
  .record(z.string(), z.unknown())
  .describe(
    'The open live journal: `open`, `base`, `seq`, `changes` (GOOD-X changes since the base)…',
  )

export const wishItem = z.object({
  key: z.string().nullable().describe('GOOD key; null when not in the table'),
  kind: z.enum(['character', 'weapon']).nullable(),
  name: z.string(),
  rarity: z.number().int(),
  itemId: z.number().int(),
})

export const wishPull = z.object({
  id: z
    .string()
    .describe('The game’s id (synthetic below 10^18 for pulls from a paimon.moe backup)'),
  banner: z.number().int().describe('UIGF type: 100, 200, 301 (and 400), 302, 500'),
  gachaType: z.number().int().describe('The game’s type (400 = the second character banner)'),
  time: z
    .string()
    .describe('As the game writes it, on the account’s server clock: "YYYY-MM-DD HH:MM:SS"'),
  item: wishItem,
})

export const wishMeta = pageMeta.extend({
  timezone: z.number().int().nullable().describe('Hours from UTC of `time`'),
  total: z.number().int(),
})

const rarityLine = z.object({ count: z.number().int(), share: z.number(), avgPity: z.number() })
const rateLine = z.object({
  won: z.number().int(),
  lost: z.number().int(),
  radiance: z.number().int().describe('Wins that were certainly Capturing Radiance'),
  rate: z.number().nullable(),
  winStreak: z.number().int(),
  maxWinStreak: z.number().int(),
  loseStreak: z.number().int(),
  maxLoseStreak: z.number().int(),
})

export const wishSummary = z.object({
  timezone: z.number().int().nullable(),
  banners: z.array(
    z.object({
      banner: z.number().int(),
      total: z.number().int(),
      pity5: z.number().int(),
      pity4: z.number().int(),
      guaranteed5: z
        .boolean()
        .nullable()
        .describe('The next 5★ is featured; null: no 50/50 here or not known'),
      guaranteed4: z.boolean().nullable(),
      radiance: z
        .number()
        .int()
        .nullable()
        .describe('Capturing Radiance counter (0–3), character event only'),
      five: rarityLine,
      four: rarityLine,
      rate5: rateLine.nullable(),
      rate4: rateLine.nullable(),
      fives: z.array(
        z.object({
          id: z.string(),
          time: z.string(),
          item: wishItem,
          pity: z.number().int(),
          outcome: z.enum(['won', 'lost', 'guaranteed', 'radiance']).nullable(),
          bannerName: z.string().nullable(),
        }),
      ),
    }),
  ),
})

export const wishImportResult = z.object({
  added: z.number().int(),
  known: z.number().int(),
  skipped: z.number().int(),
})

export const marks = z.object({
  marked: z
    .array(z.number().int())
    .describe('Ids marked done by hand; what the capture says done is in the GOOD file'),
})

export const loose = (what: string) => z.record(z.string(), z.unknown()).describe(what)

export const member = z.object({
  userId: z.number().int(),
  username: z.string(),
  role: z.enum(['owner', 'editor', 'viewer']),
  invitedAt: time,
  acceptedAt: nullableTime.describe('null: invited, not accepted yet'),
})

export const invitation = z.object({
  accountId: z.number().int(),
  accountName: z.string().nullable(),
  uid: z.string().nullable(),
  owner: z.string(),
  role: z.enum(['editor', 'viewer']),
  invitedAt: time,
})
