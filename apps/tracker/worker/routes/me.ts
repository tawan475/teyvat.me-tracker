import { userSettingsPatch, type ImportKeyResponse, type UsageResponse } from '@gdt/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '../db/client'
import { users } from '../db/schema'
import type { AppEnv } from '../env'
import { ApiError, parseJson } from '../lib/http'
import { requireActiveSession, requireUser } from '../lib/session'
import { newImportKey } from '../services/accounts'
import { liveDb } from '../services/live-sync'
import { meFromResults, patchUserSettingsStatement } from '../services/me'
import { userRolesStatement } from '../services/roles'
import { userUsage } from '../services/usage'
import { toMe } from './auth'

export const me = new Hono<AppEnv>()
  .use(requireUser)

  /** What the user stores against their quota, split by kind, per account. */
  .get('/usage', async (c) =>
    c.json<UsageResponse>(await userUsage(c.env.DB, liveDb(c.env), c.get('userId'))),
  )

  /**
   * Saves the keys sent over the settings as stored (merged in the UPDATE,
   * services/me `patchUserSettingsStatement`): another tab's save of other
   * keys meanwhile stays. One round trip, the answer is the row as written.
   */
  .patch('/settings', async (c) => {
    const patch = await parseJson(c, userSettingsPatch)
    const userId = c.get('userId')
    const [written, roles] = await c.env.DB.batch([
      patchUserSettingsStatement(c.env.DB, userId, patch),
      userRolesStatement(c.env.DB, userId),
    ])
    const found = meFromResults(userId, written, roles)
    if (!found) throw new ApiError(401, 'unauthenticated', 'Not signed in')
    return c.json(toMe(found.user, c.env, found.permissions))
  })

  /**
   * The user's Irminsul key for all their accounts (see routes/public): a new
   * one replaces the old, which stops working at once. Shown once; only its
   * hash is stored.
   */
  .post('/import-key', requireActiveSession, async (c) => {
    const { key, hash } = await newImportKey('user')
    const [updated] = await getDb(c.env.DB)
      .update(users)
      .set({ importKeyHash: hash })
      .where(eq(users.id, c.get('userId')))
      .returning({ id: users.id })
    if (!updated) throw new ApiError(401, 'unauthenticated', 'Not signed in')
    return c.json<ImportKeyResponse>({ importKey: key })
  })

  /** Revokes the user's key; accounts' own keys keep working. */
  .delete('/import-key', async (c) => {
    await getDb(c.env.DB)
      .update(users)
      .set({ importKeyHash: null })
      .where(eq(users.id, c.get('userId')))
    return c.body(null, 204)
  })
