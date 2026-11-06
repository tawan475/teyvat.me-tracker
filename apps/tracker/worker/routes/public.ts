/**
 * Routes authenticated by an import key rather than a session.
 * Paths and shapes are irminsul's wire contract (`irminsul/src/monitor.rs`):
 * the key arrives in `x-import-key`; any 2xx is success; 401/403 makes
 * irminsul re-verify its key; `verify-key` is read from the top level.
 * Responses only ever gain fields (irminsul ignores unknown ones): an import
 * answers with `warnings` when the file's UID is not the account's, and with
 * the `account` it went to.
 *
 * Two kinds of key: an account's own key uploads to that account; a user's
 * key uploads to the user's account whose UID is the file's `gi_player.uid`,
 * making that account on the first upload of a new UID.
 *
 * Limits (irminsul shows the message of any refusal): 20 uploads a minute
 * per key (KEY_IMPORT_LIMITER; irminsul uploads at most every few seconds,
 * and only when the game sent new data), 60 verifications a minute per key,
 * 20 unknown keys a minute per IP; per file GOOD_LIMITS (422) and the
 * owner's daily and storage quotas (429 / 413, services/upload-limits.ts).
 */

import type { VerifyKeyResponse } from '@gdt/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { pageOrigin } from '../lib/email'
import { readUpload } from '../lib/upload'
import { keyOwner } from '../lib/uploader'
import { uploadAs } from '../services/upload-as'

export const publicImport = new Hono<AppEnv>()
  .get('/verify-key', async (c) => {
    const owner = await keyOwner(c, c.env.IMPORT_LIMITER)
    // The site's own origin (pageOrigin), so links are right for any deployment.
    if (owner.scope === 'user') {
      return c.json<VerifyKeyResponse>({
        accountId: null,
        accountName: `${owner.user.username} · all accounts`,
        uid: null,
        server: null,
        dashboardUrl: new URL('/app', pageOrigin(c.env, c.req.url)).href,
        scope: 'user',
      })
    }
    const { account } = owner
    return c.json<VerifyKeyResponse>({
      accountId: account.id,
      accountName: account.name,
      uid: account.uid,
      server: account.server,
      dashboardUrl: new URL(`/app/a/${account.id}`, pageOrigin(c.env, c.req.url)).href,
      scope: 'account',
    })
  })

  .post('/import-by-key', async (c) => {
    const owner = await keyOwner(c, c.env.KEY_IMPORT_LIMITER)
    return uploadAs(c, owner, await readUpload(c), {
      uidRequired:
        "This file has no UID (gi_player.uid), so your all-accounts key can't tell which account it is. Update Teyvat.me Capture, or use the account's own import key.",
    })
  })
