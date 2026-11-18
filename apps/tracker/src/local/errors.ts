/**
 * An error the guest's local routes answer with: the Worker's shape
 * (`{error: {code, message}}` with its status), so callers branch on the
 * same codes whether the account is on the server or in this browser.
 */
export class LocalApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'LocalApiError'
  }
}

/** What a guest can't do without an account (a route the server alone answers). */
export const needsAccount = () =>
  new LocalApiError(403, 'guest_needs_account', 'This needs an account')

/** A watched folder's file of another player (guest mode keeps one Genshin account). */
export class OtherUidError extends LocalApiError {
  constructor(
    readonly uid: string,
    readonly own: string,
  ) {
    super(409, 'guest_other_uid', `This file is UID ${uid}; guest mode keeps UID ${own}`)
    this.name = 'OtherUidError'
  }
}

/**
 * A watched folder's file whose folder is no longer the one kept: the guest
 * data was deleted, or another folder picked, while it was being read
 * (folder-record.ts). Nothing of it is stored.
 */
export class FolderForgottenError extends LocalApiError {
  constructor() {
    super(409, 'guest_folder_gone', 'This folder is not watched any more')
    this.name = 'FolderForgottenError'
  }
}
