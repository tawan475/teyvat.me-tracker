/**
 * Passkeys in the browser: the WebAuthn calls around `/api/auth/passkeys`.
 * The server's options are base64url JSON; `navigator.credentials` wants
 * bytes, and its answers go back as base64url JSON (the shape
 * `PublicKeyCredential.toJSON()` gives, built by hand for older browsers).
 */

import type { PasskeyCreationOptions, PasskeyRequestOptions, PasskeyResponse } from '@gdt/shared'
import { api } from '@/api'

function toB64url(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** This browser has WebAuthn at all. */
export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential === 'function' &&
    typeof navigator.credentials?.create === 'function'
  )
}

/** This device can make a passkey itself (Windows Hello, Touch ID, a phone's lock). */
export async function platformPasskeyAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

/** The browser offers passkeys in the username box's autofill. */
export async function conditionalAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false
  try {
    return (await PublicKeyCredential.isConditionalMediationAvailable?.()) === true
  } catch {
    return false
  }
}

/** The user closed the browser's dialog (or it timed out): nothing to say. */
export function cancelled(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  )
}

function creationOptions(json: PasskeyCreationOptions): PublicKeyCredentialCreationOptions {
  return {
    ...json,
    challenge: fromB64url(json.challenge),
    user: { ...json.user, id: fromB64url(json.user.id) },
    excludeCredentials: json.excludeCredentials.map((c) => ({
      type: c.type,
      id: fromB64url(c.id),
      ...(c.transports ? { transports: c.transports as AuthenticatorTransport[] } : {}),
    })),
  }
}

function requestOptions(json: PasskeyRequestOptions): PublicKeyCredentialRequestOptions {
  return { ...json, challenge: fromB64url(json.challenge) }
}

/** Makes a passkey on this device and keeps it on the account. Null: the user cancelled. */
export async function createPasskey(): Promise<PasskeyResponse | null> {
  const options = creationOptions(await api.passkeyCreationOptions())
  let credential: PublicKeyCredential
  try {
    credential = (await navigator.credentials.create({ publicKey: options })) as PublicKeyCredential
  } catch (error) {
    if (cancelled(error)) return null
    throw error
  }
  const response = credential.response as AuthenticatorAttestationResponse
  return api.addPasskey({
    id: credential.id,
    rawId: toB64url(credential.rawId),
    type: 'public-key',
    response: {
      clientDataJSON: toB64url(response.clientDataJSON),
      attestationObject: toB64url(response.attestationObject),
      transports: response.getTransports?.() ?? [],
    },
  })
}

export interface PasskeyAnswer {
  credential: {
    id: string
    rawId: string
    type: 'public-key'
    response: {
      clientDataJSON: string
      authenticatorData: string
      signature: string
      userHandle: string | null
    }
  }
  rpId: string
}

/**
 * Asks the browser for a passkey of this site. `conditional`: offered in
 * the username box's autofill, waiting until the user picks one (or
 * `signal` aborts). Null: cancelled or aborted.
 */
export async function getPasskey(
  options: { conditional?: boolean; signal?: AbortSignal } = {},
): Promise<PasskeyAnswer | null> {
  const json = await api.passkeyRequestOptions()
  if (options.signal?.aborted) return null
  let credential: PublicKeyCredential | null
  try {
    credential = (await navigator.credentials.get({
      publicKey: requestOptions(json),
      ...(options.conditional
        ? { mediation: 'conditional' as CredentialMediationRequirement }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })) as PublicKeyCredential | null
  } catch (error) {
    if (cancelled(error)) return null
    throw error
  }
  if (!credential) return null
  const response = credential.response as AuthenticatorAssertionResponse
  return {
    rpId: json.rpId,
    credential: {
      id: credential.id,
      rawId: toB64url(credential.rawId),
      type: 'public-key',
      response: {
        clientDataJSON: toB64url(response.clientDataJSON),
        authenticatorData: toB64url(response.authenticatorData),
        signature: toB64url(response.signature),
        userHandle: response.userHandle ? toB64url(response.userHandle) : null,
      },
    },
  }
}

/**
 * Tells the browser a passkey is no longer on any account (it was removed
 * here), so its autofill stops offering it. Only where the Signal API exists.
 */
export function forgetPasskey(answer: PasskeyAnswer): void {
  const signal = (
    PublicKeyCredential as unknown as {
      signalUnknownCredential?: (o: { rpId: string; credentialId: string }) => Promise<void>
    }
  ).signalUnknownCredential
  signal
    ?.call(PublicKeyCredential, { rpId: answer.rpId, credentialId: answer.credential.id })
    .catch(() => undefined)
}
