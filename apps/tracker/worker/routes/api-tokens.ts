/**
 * Settings → API tokens (docs/plans/public-api.md §10): list, make, rename
 * and revoke the user's personal API tokens. Every route needs a live
 * sign-in (`requireActiveSession`): a token never makes or lists tokens.
 */

import {
  API_TOKEN_LIMIT,
  API_TOKEN_PREFIX,
  apiTokenCreate,
  apiTokenPatch,
  maskWrites,
  scopeMask,
  type ApiTokenCreatedResponse,
  type ApiTokenResponse,
  type ApiTokensResponse,
} from '@gdt/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { forgetApiToken, limitsOf } from '../lib/api-token'
import { randomToken, sha256Hex } from '../lib/crypto'
import { ApiError, parseJson } from '../lib/http'
import { requireActiveSession, requireUser } from '../lib/session'
import { accessibleAccountsSql } from '../services/accounts'

const DAY_MS = 86_400_000

function tokenFromRow(row: Record<string, unknown>): ApiTokenResponse {
  return {
    id: String(row.id),
    name: String(row.name),
    write: maskWrites(Number(row.scopes)),
    accounts:
      typeof row.account_ids === 'string' ? (JSON.parse(row.account_ids) as number[]) : null,
    createdAt: Number(row.created_at),
    expiresAt: row.expires_at == null ? null : Number(row.expires_at),
    lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
    lastCountry: row.last_country == null ? null : String(row.last_country),
  }
}

const notFound = () => new ApiError(404, 'not_found', 'No such token')

/** A token id: 12 base64url characters (9 random bytes). */
const newId = () => randomToken(9)

export const apiTokens = new Hono<AppEnv>()
  .use(requireUser, requireActiveSession)

  /** The user's live tokens (not revoked, not expired), newest first, and their limits. */
  .get('/', async (c) => {
    const now = Date.now()
    const [tokens, user] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        `SELECT id, name, scopes, account_ids, created_at, expires_at, last_used_at, last_country
           FROM api_tokens
          WHERE user_id = ?1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?2)
          ORDER BY created_at DESC`,
      ).bind(c.get('userId'), now),
      c.env.DB.prepare('SELECT api_tier, api_limits FROM users WHERE id = ?1').bind(
        c.get('userId'),
      ),
    ])
    const row = user!.results[0]
    return c.json<ApiTokensResponse>({
      tokens: tokens!.results.map(tokenFromRow),
      limits: limitsOf(row?.api_tier, row?.api_limits),
    })
  })

  /** Makes a token; its whole value is in this answer only. */
  .post('/', async (c) => {
    const input = await parseJson(c, apiTokenCreate)
    const userId = c.get('userId')
    const now = Date.now()
    const [count, visible] = await c.env.DB.batch<Record<string, unknown>>([
      c.env.DB.prepare(
        `SELECT COUNT(*) AS n FROM api_tokens
          WHERE user_id = ?1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?2)`,
      ).bind(userId, now),
      c.env.DB.prepare(accessibleAccountsSql('a.id')).bind(userId),
    ])
    if (Number(count!.results[0]?.n ?? 0) >= API_TOKEN_LIMIT) {
      throw new ApiError(409, 'too_many_tokens', `At most ${API_TOKEN_LIMIT} tokens`)
    }
    let accounts: number[] | null = null
    if (input.accounts) {
      const mine = new Set(visible!.results.map((r) => Number(r.id)))
      accounts = [...new Set(input.accounts)].sort((a, b) => a - b)
      if (accounts.some((id) => !mine.has(id))) {
        throw new ApiError(400, 'invalid_request', 'An account in the list is not yours')
      }
    }
    const id = newId()
    const secret = randomToken(32)
    const row = {
      id,
      name: input.name,
      scopes: scopeMask(input.write),
      account_ids: accounts ? JSON.stringify(accounts) : null,
      created_at: now,
      expires_at: input.expiresInDays === null ? null : now + input.expiresInDays * DAY_MS,
      last_used_at: null,
      last_country: null,
    }
    await c.env.DB.prepare(
      `INSERT INTO api_tokens (id, user_id, name, secret_hash, scopes, account_ids, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(
        id,
        userId,
        row.name,
        await sha256Hex(secret),
        row.scopes,
        row.account_ids,
        now,
        row.expires_at,
      )
      .run()
    return c.json<ApiTokenCreatedResponse>(
      { token: tokenFromRow(row), secret: `${API_TOKEN_PREFIX}${id}_${secret}` },
      201,
    )
  })

  .patch('/:id', async (c) => {
    const { name } = await parseJson(c, apiTokenPatch)
    const row = await c.env.DB.prepare(
      `UPDATE api_tokens SET name = ?3 WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL
       RETURNING id, name, scopes, account_ids, created_at, expires_at, last_used_at, last_country`,
    )
      .bind(c.req.param('id'), c.get('userId'), name)
      .first<Record<string, unknown>>()
    if (!row) throw notFound()
    return c.json<ApiTokenResponse>(tokenFromRow(row))
  })

  /** Revokes every token of the user. */
  .post('/revoke-all', async (c) => {
    const { results } = await c.env.DB.prepare(
      'UPDATE api_tokens SET revoked_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL RETURNING id',
    )
      .bind(c.get('userId'), Date.now())
      .all<{ id: string }>()
    for (const { id } of results) forgetApiToken(id)
    return c.body(null, 204)
  })

  .delete('/:id', async (c) => {
    const row = await c.env.DB.prepare(
      'UPDATE api_tokens SET revoked_at = ?3 WHERE id = ?1 AND user_id = ?2 AND revoked_at IS NULL RETURNING id',
    )
      .bind(c.req.param('id'), c.get('userId'), Date.now())
      .first()
    if (!row) throw notFound()
    forgetApiToken(c.req.param('id'))
    return c.body(null, 204)
  })
