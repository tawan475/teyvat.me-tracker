/**
 * The public API's guide (docs/plans/public-api.md §9): the sections before
 * the endpoint reference. Plain data, read by the docs page
 * (/developers/api) and by the Markdown file for AI helpers
 * (/developers/api.md, worker/api/v1/markdown.ts), so the two say the same.
 * English on purpose, like /developers. `text` may hold `code` in backticks.
 */

import { API_LIMITS, type ApiBucket } from '@gdt/shared'

export type GuideBlock =
  | { text: string }
  | { code: string; lang?: string }
  | { list: string[] }
  | { table: { head: string[]; rows: string[][] } }

export interface GuideSection {
  id: string
  title: string
  blocks: GuideBlock[]
}

export const KOFI_URL = 'https://ko-fi.com/tawan475'
export const DISCORD_URL = 'https://discord.gg/W6GUY3UtAx'

const BUCKET_ROWS: [ApiBucket, string][] = [
  ['read', 'Everything not below'],
  ['good', 'GOOD of the newest or a snapshot, GOOD sections'],
  ['wish-summary', 'Wish summary (computed)'],
  ['farm', 'Farm plan (computed)'],
  ['wish-export', 'UIGF export'],
  ['upload', 'Upload a snapshot'],
  ['wish-import', 'Wish import'],
  ['write', 'Every other POST, PATCH, DELETE'],
  ['destructive', 'Delete all wishes, compact history, delete an account'],
]

const per = (n: number | null) => (n === null ? 'global only' : `${n} / min`)

export const API_GUIDE: GuideSection[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    blocks: [
      {
        text: 'The Teyvat.me API reads and changes what you keep on Teyvat.me: your Genshin accounts, their snapshots (GOOD files), wish history, achievement marks, the Planner and sharing. It answers JSON under `https://teyvat.me/api/v1`.',
      },
      {
        list: [
          'Make a token: Settings → API tokens → Create token. Every token reads all areas of the accounts it covers; tick what it may also change.',
          'Send it as `Authorization: Bearer <token>`.',
          'Read the limits from the answers’ headers, and poll no more often than every 5 minutes, with `If-None-Match`.',
        ],
      },
      {
        code: 'curl https://teyvat.me/api/v1/accounts \\\n  -H "Authorization: Bearer $TEYVAT_TOKEN"',
        lang: 'bash',
      },
      {
        text: 'The whole reference is also machine-readable: `/api/v1/openapi.json` (OpenAPI 3.1) and `/developers/api.md` (one Markdown file, for AI helpers).',
      },
    ],
  },
  {
    id: 'authentication',
    title: 'Authentication',
    blocks: [
      {
        text: 'A token looks like `gdt_pat_<id>_<secret>`. It is shown once when made; only a hash of its secret is kept. It expires after 30, 90 or 365 days, or never, and can be revoked in Settings at any time. A revoked token can keep working for up to a minute.',
      },
      {
        list: [
          'Areas: `accounts`, `snapshots`, `wishes`, `progress`, `planner`, `sharing`, `capture`. A token reads every area; it writes only the ones it was given. A route it can’t use answers 403 `scope_missing`.',
          'A token covers all your accounts, or the ones you picked (403 `account_not_in_token` for others).',
          'On an account shared with you, a token can do what your role allows: a viewer’s token never writes.',
          'A token never changes your password, email, passkeys, sign-ins or devices, never makes tokens or import keys, and never deletes your user.',
        ],
      },
      {
        text: 'Browsers: answers carry `Access-Control-Allow-Origin: *`, so a page can call the API with a token the user pastes. Never put a token in a page’s source.',
      },
    ],
  },
  {
    id: 'responses',
    title: 'Responses',
    blocks: [
      {
        text: 'Every success is an object with `data`; lists add `meta`. Fields are camelCase and always present (`null` when unknown). Times are ISO 8601 UTC, except wish times, which are the game’s own text on the account’s server clock. Wish ids are strings. Game things use their GOOD keys.',
      },
      {
        code: '{ "data": { … } }\n{ "data": [ … ], "meta": { "nextCursor": "…", "limit": 50 } }',
        lang: 'json',
      },
      {
        list: [
          'Raw first: answers are the data as stored. Only the wish summary and the farm plan are computed.',
          'Every answer has `X-Request-Id`; quote it in a bug report.',
          '`ETag` on reads: send it back as `If-None-Match` and an unchanged account answers 304 at once.',
        ],
      },
    ],
  },
  {
    id: 'errors',
    title: 'Errors',
    blocks: [
      {
        text: 'Errors are RFC 9457 problem details (`application/problem+json`). `code` is the stable name to act on; `detail` is for people.',
      },
      {
        code: '{\n  "type": "https://teyvat.me/developers/api#error-scope_missing",\n  "title": "Missing scope",\n  "status": 403,\n  "code": "scope_missing",\n  "detail": "This token can\'t change progress",\n  "instance": "req_9Kd2mQ7xR4tA"\n}',
        lang: 'json',
      },
      {
        table: {
          head: ['Status', 'Code', 'Meaning'],
          rows: [
            [
              '400',
              '`invalid_request`, `invalid_json`',
              'The body or query failed validation (`errors` lists where)',
            ],
            ['401', '`token_invalid`, `token_expired`, `unauthenticated`', 'No usable token'],
            [
              '403',
              '`scope_missing`, `account_not_in_token`, `forbidden`, `account_suspended`',
              'Not allowed',
            ],
            ['404', '`not_found`', 'No such thing, or not yours'],
            [
              '409',
              '`uid_taken`, `capture_changed`, `not_playing`',
              'The state doesn’t allow it now',
            ],
            [
              '413 / 422 / 429',
              '`storage_quota`, `too_many_items`, `daily_upload_limit`',
              'Upload limits',
            ],
            ['429', '`rate_limited`', 'A rate limit: wait `Retry-After` seconds'],
          ],
        },
      },
    ],
  },
  {
    id: 'pagination',
    title: 'Pagination',
    blocks: [
      {
        text: 'Lists take `limit` (1–200, default 50) and `cursor`. Pass the last page’s `meta.nextCursor` to get the next one; `null` means the last page. Cursors are opaque.',
      },
    ],
  },
  {
    id: 'rate-limits',
    title: 'Rate limits',
    blocks: [
      {
        text: 'Two layers, per user: a global limit on every request, and a bucket per endpoint, counted per account on routes under `/accounts/{id}`. Every token you make shares them. Per minute.',
      },
      {
        table: {
          head: ['Bucket', 'Endpoints', 'Free', 'Supporter'],
          rows: [
            [
              'global',
              'Every request, 304s included',
              per(API_LIMITS.free.global),
              per(API_LIMITS.supporter.global),
            ],
            ...BUCKET_ROWS.map(([bucket, what]) => [
              `\`${bucket}\``,
              what,
              per(API_LIMITS.free.buckets[bucket]),
              per(API_LIMITS.supporter.buckets[bucket]),
            ]),
          ],
        },
      },
      {
        list: [
          'Every answer: `X-RateLimit-Bucket`, `X-RateLimit-Limit` (the bucket’s), `X-RateLimit-Global-Limit`, `X-RateLimit-Tier`.',
          'A 429 adds `X-RateLimit-Scope` (`user`, `global` or `ip`), `X-RateLimit-Global: true` for the global limit, and `Retry-After`; the problem body has `scope`, `global`, `bucket`, `limit` and `retryAfter`.',
          'Counts are approximate (counted per Cloudflare location), so no remaining count is sent. Don’t hard-code the numbers: read the headers.',
          'More than 60 rejected tokens (401 / 403) from one address in 10 minutes blocks it for 10 minutes. Stop using a token once it answers 401.',
          'Uploads also keep the daily snapshot and storage limits every account has. Game data files are never counted.',
        ],
      },
    ],
  },
  {
    id: 'supporter',
    title: 'Supporter limits',
    blocks: [
      {
        text: 'Supporters get three times every bucket (and the global limit). Nothing else changes.',
      },
      {
        list: [
          `Help with server costs on Ko-fi: ${KOFI_URL}`,
          `Message us on Discord with your Teyvat.me username: ${DISCORD_URL}`,
          'We switch your limits on.',
        ],
      },
      { text: `Need more than that? Contact us on Discord to discuss: ${DISCORD_URL}` },
    ],
  },
  {
    id: 'versioning',
    title: 'Versioning',
    blocks: [
      {
        text: '`/api/v1` only grows: new endpoints, new fields, new enum values. Ignore what you don’t know. A breaking change makes `/api/v2`; v1 then keeps answering for at least 12 months, with `Deprecation` and `Sunset` headers and a changelog entry.',
      },
    ],
  },
  {
    id: 'game-data',
    title: 'Game data',
    blocks: [
      {
        text: 'Answers use GOOD keys and game ids. Names, icons and rarities are in public files under `/data/v1/` (no token, not counted). Start from `/data/v1/manifest.json`: it names the game data version, the languages and every file with its hash.',
      },
      {
        code: 'curl https://teyvat.me/data/v1/manifest.json\ncurl https://teyvat.me/data/v1/en/characters.json',
        lang: 'bash',
      },
      {
        text: 'Each entry carries its `icon` as a full URL (or `null`): game art is linked, never stored on Teyvat.me.',
      },
    ],
  },
  {
    id: 'changelog',
    title: 'Changelog',
    blocks: [{ list: ['2026-11-14: v1.'] }],
  },
]
