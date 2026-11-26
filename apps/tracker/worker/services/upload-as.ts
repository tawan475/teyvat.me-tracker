/**
 * One upload for an owner who is already known and allowed: an import key's
 * (routes/public) or a signed-in irminsul's session (routes/irminsul). Both
 * answer the same: the import's response with the `account` it went to.
 *
 * An account owner uploads to that account, which takes the file's
 * `gi_player.uid` (else GGScanner's `metadata.uid`, `uploadUid`) when it
 * differs (`takeAccountUid`); a user owner to the user's account whose UID is
 * the file's, made on the first upload of a new UID (422 `uid_required` for a
 * file without one).
 */

import {
  UPLOAD_SUPPORT,
  itemIndexKey,
  preparedItemIndex,
  resolveDeferredArtifacts,
  uploadUid,
  type ImportResponse,
  type PreparedSnapshot,
} from '@gdt/shared'
import type { Context } from 'hono'
import type { AppEnv } from '../env'
import { ApiError } from '../lib/http'
import type { ImportStages } from '../lib/import-stages'
import { D1Meter } from '../lib/meter'
import { accountForUid, takeAccountUid, type KeyAccount, type UploadOwner } from './accounts'
import { importSnapshot, parseUpload, type Upload } from './import'
import { snapshotFacts } from './alerts'
import { anyListening, notifyAccount, notifyUser, tellAlertFacts } from './live'
import { liveDb, liveUsage, openJournal } from './live-sync'

export async function uploadAs(
  c: Context<AppEnv>,
  owner: UploadOwner,
  upload: Upload,
  /** `uidRequired`: what a file without a UID is told (how to fix it differs per caller). */
  text: { uidRequired: string },
  /** The upload's import_stages line, logged once it is answered (or failed). */
  stages?: ImportStages,
): Promise<Response> {
  const meter = new D1Meter()
  return store(c, owner, upload, text, meter, stages).catch((error: unknown) => {
    stages?.done(meter, { error })
    throw error
  })
}

async function store(
  c: Context<AppEnv>,
  owner: UploadOwner,
  upload: Upload,
  text: { uidRequired: string },
  meter: D1Meter,
  stages: ImportStages | undefined,
): Promise<Response> {
  let account: KeyAccount
  let userId: number
  let created = false
  let parsed: PreparedSnapshot | undefined
  let uidWas: string | null | undefined
  if (owner.scope === 'account') {
    account = owner.account
    userId = owner.userId
    parsed = await parseUpload(upload.text)
    stages?.lap('parse')
    const uid = uploadUid(parsed.good)
    const was = account.uid
    if (uid !== undefined && (await takeAccountUid(c.env.DB, meter, account, String(uid)))) {
      uidWas = was
    }
  } else {
    userId = owner.user.id
    parsed = await parseUpload(upload.text)
    stages?.lap('parse')
    const uid = uploadUid(parsed.good)
    if (uid === undefined) throw new ApiError(422, 'uid_required', text.uidRequired)
    ;({ account, created } = await accountForUid(
      c.env.DB,
      meter,
      owner.user.id,
      String(uid),
      owner.accounts,
    ))
  }
  stages?.lap('owner')
  const live = liveDb(c.env)
  const result = await importSnapshot(
    c.env.DB,
    account,
    upload,
    meter,
    parsed,
    live ? liveUsage(live, account.user_id ?? userId) : undefined,
    stages,
  ).catch((error: unknown) => {
    // The account this upload made stays, whatever happened to the file.
    if (created) notifyUser(c, userId, { type: 'accounts' })
    throw error
  })
  const { response, dataVersion, listener } = result
  meter.report(c)
  if (uidWas !== undefined) {
    response.warnings = [
      ...(response.warnings ?? []),
      {
        code: 'uid_changed',
        message: uidWas
          ? `The account's UID was ${uidWas}; it is now ${account.uid}, this capture's.`
          : `The account's UID is now ${account.uid}, this capture's.`,
      },
    ]
    notifyUser(c, userId, { type: 'accounts' })
  }
  // Live sync: this snapshot opens the account's journal (a failure leaves
  // the answer without `live`, so irminsul keeps to snapshots).
  if (live && result.newest) {
    try {
      // The journal's item index. When the artifact list was not read (a
      // stored section stood in for it), the index of the journal row stands
      // if it was made from the same items; else the list is read after all.
      const index = preparedItemIndex(result.prepared.good)
      const itemsKey = result.artifactsFingerprint
        ? await itemIndexKey(result.artifactsFingerprint, index?.weapons ?? [])
        : null
      const base = await openJournal(live, {
        accountId: account.id,
        userId: account.user_id ?? userId,
        contentKey: result.contentKey,
        snapshotId: response.snapshotId,
        takenAt: response.takenAt,
        session: result.prepared.good.capture?.session ?? '',
        summary: result.prepared.summary,
        items: result.heldArtifacts ? null : index,
        itemsKey,
        ...(result.heldArtifacts
          ? {
              itemsLater: async () =>
                preparedItemIndex((await resolveDeferredArtifacts(result.prepared)).good),
            }
          : {}),
        off: result.prepared.good.off,
      })
      response.live = { base, watching: anyListening(listener) }
    } catch (error) {
      console.warn('live_open_failed', JSON.stringify({ accountId: account.id }), String(error))
    }
    stages?.lap('journal')
  }
  // Only when someone listens (read in the import's own batch). A new
  // account is in the list now even when its first file changed nothing.
  if (dataVersion !== null || created) {
    notifyAccount(
      c,
      listener,
      { type: 'data', accountId: account.id, dataVersion, takenAt: response.takenAt },
      userId,
    )
  }
  // Alerts: the newest capture's resin and tasks (only to hubs that want them).
  if (result.newest) {
    tellAlertFacts(c, listener, account.id, {
      ...snapshotFacts(result.prepared.good, response.takenAt),
      name: account.name,
      uid: account.uid,
      server: account.server,
    })
  }
  stages?.lap('after')
  stages?.done(meter, { status: response.status })
  return c.json<ImportResponse>(
    {
      ...response,
      account: { id: account.id, name: account.name, uid: account.uid, created },
      upload: UPLOAD_SUPPORT,
    },
    response.status === 'created' ? 201 : 200,
  )
}
