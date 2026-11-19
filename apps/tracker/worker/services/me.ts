import type { UserSettingsPatch } from '@gdt/shared'
import type { users } from '../db/schema'
import { patchedSettingsSql } from './accounts'
import { permissionsOf, roleFromRow, standingOf, userRolesStatement } from './roles'

type User = typeof users.$inferSelect

/** What MeResponse is made from (routes/auth `toMe`). */
export type MeSource = Pick<
  User,
  'id' | 'username' | 'email' | 'emailVerified' | 'settings' | 'importKeyHash' | 'passwordHash'
>

interface MeRow {
  id: number
  username: string
  email: string | null
  email_verified: number
  settings: string
  import_key_hash: string | null
  password_hash: string
}

/** The columns MeSource is read from (meFromResults). */
const ME_COLUMNS = 'id, username, email, email_verified, settings, import_key_hash, password_hash'

/**
 * The signed-in user's row and roles: two statements for one `batch()` (one
 * D1 round trip), read with `meFromResults`.
 */
export function meStatements(
  d1: D1Database,
  userId: number,
): [D1PreparedStatement, D1PreparedStatement] {
  return [
    d1.prepare(`SELECT ${ME_COLUMNS} FROM users WHERE id = ?1`).bind(userId),
    userRolesStatement(d1, userId),
  ]
}

/** A settings key as a JSON path step may name it without quoting. */
const PATH_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The JSON paths (`$.progressionGraphs`) of every null in a settings patch,
 * objects walked key by key (a list is a value: nothing inside it is a
 * path). A JSON merge patch cannot store a null: it removes the key, which
 * then reads as its default. That is the same thing only while the key's
 * default is null, so each of these keys is written as an explicit null
 * after the merge (patchUserSettingsStatement) and reads back as null
 * whatever its default is.
 */
export function nullPaths(patch: object, base = '$'): string[] {
  const paths: string[] = []
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (!PATH_KEY.test(key)) throw new Error(`Not a settings key: ${JSON.stringify(key)}`)
    const path = `${base}.${key}`
    if (value === null) paths.push(path)
    else if (typeof value === 'object' && !Array.isArray(value))
      paths.push(...nullPaths(value as object, path))
  }
  return paths
}

/**
 * Lays `patch` over the user's settings in the UPDATE itself, on the row as
 * stored at that moment (the account settings' way, services/accounts
 * `patchedSettingsSql`): two tabs saving different keys (the theme in one,
 * the tab bar in the other) each keep the other's, where a read-then-write
 * wrote back a copy read before the other's save. It merges as deepMerge
 * does (objects key by key, lists and scalars replaced), and a null is
 * stored as a null (`nullPaths`). Answers the row as written, in
 * `meStatements`' columns: no row means the user is gone.
 */
export function patchUserSettingsStatement(
  d1: D1Database,
  userId: number,
  patch: UserSettingsPatch,
): D1PreparedStatement {
  const nulls = nullPaths(patch)
  const merged = patchedSettingsSql('?2')
  const written = nulls.length
    ? `json_set(${merged}, ${nulls.map((_, i) => `?${i + 3}, json('null')`).join(', ')})`
    : merged
  return d1
    .prepare(`UPDATE users SET settings = ${written} WHERE id = ?1 RETURNING ${ME_COLUMNS}`)
    .bind(userId, JSON.stringify(patch), ...nulls)
}

/** The user (null: gone) and their permission nodes from `meStatements`' results. */
export function meFromResults(
  userId: number,
  user: D1Result | undefined,
  roles: D1Result | undefined,
): { user: MeSource; permissions: string[] } | null {
  const row = user?.results[0] as MeRow | undefined
  if (!row) return null
  const rows = (roles?.results ?? []) as Record<string, unknown>[]
  return {
    user: {
      id: row.id,
      username: row.username,
      email: row.email,
      emailVerified: row.email_verified === 1,
      settings: JSON.parse(row.settings) as UserSettingsPatch,
      importKeyHash: row.import_key_hash,
      passwordHash: row.password_hash,
    },
    permissions: permissionsOf(standingOf(userId, rows.map(roleFromRow))),
  }
}
