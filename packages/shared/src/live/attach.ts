/**
 * The attach request (Capture 1.17.21): `POST /api/irminsul/attach`. Data the
 * game sends only when a screen is opened, after the login's snapshot (the
 * Stygian records, the Spiral Abyss record book, the Theater's state after a
 * run), goes up on its own, small, and the tracker writes it into the
 * session's newest snapshot in place of what that snapshot held of it. No
 * new snapshot, no journal: the pages read the snapshot as before.
 *
 * `gi_endgame` carries the parts the capture has; each part present replaces
 * the snapshot's whole part (a part absent is left as stored). Answers:
 * 200 `{ok, snapshotId, takenAt, dataVersion, stored}` (`stored` the bytes
 * the new section took; 0 when the data was already there), 400
 * `invalid_endgame`, 404 `no_snapshot` (the account has none yet), 409
 * `session_mismatch` (the newest snapshot is another login's: the next
 * login's snapshot carries the data anyway), 413 `attach_too_large`.
 */

import { z } from 'zod'

/** The request body at most (gzip allowed): the record book of a six-year player is ~20 KB. */
export const ATTACH_MAX_BYTES = 128 * 1024

export const attachRequestSchema = z.object({
  v: z.literal(1),
  uid: z.number().int().positive().max(0xffff_ffff),
  /** The login's session id (`gi_capture.session` of its snapshot). */
  session: z.string().min(8).max(64),
  gi_endgame: z.record(z.string(), z.unknown()),
})
export type AttachRequest = z.infer<typeof attachRequestSchema>

export interface AttachResponse {
  ok: true
  snapshotId: number
  takenAt: number
  dataVersion: number
  stored: number
}
