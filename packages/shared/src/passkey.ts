/**
 * Passkeys (WebAuthn) on the wire: what `/api/auth/passkeys/*` takes and
 * answers. Binary fields are base64url, as WebAuthn's own JSON forms are
 * (`PublicKeyCredential.toJSON()`), so the browser side is a thin layer
 * over `navigator.credentials`.
 */
import { z } from 'zod'

const b64url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/)

/** A passkey's name, as the user gives it. */
export const passkeyName = z.string().trim().min(1).max(64)

/** What `navigator.credentials.create` answered, as the browser sends it. */
export const passkeyRegisterRequest = z.object({
  name: passkeyName.optional(),
  credential: z.object({
    id: b64url(1400),
    rawId: b64url(1400),
    type: z.literal('public-key'),
    response: z.object({
      clientDataJSON: b64url(4096),
      attestationObject: b64url(16384),
      transports: z.array(z.string().max(32)).max(8).optional(),
    }),
  }),
})

/** What `navigator.credentials.get` answered. */
export const passkeyLoginRequest = z.object({
  credential: z.object({
    id: b64url(1400),
    rawId: b64url(1400),
    type: z.literal('public-key'),
    response: z.object({
      clientDataJSON: b64url(4096),
      authenticatorData: b64url(4096),
      signature: b64url(2048),
      userHandle: z
        .string()
        .max(256)
        .regex(/^[A-Za-z0-9_-]*$/)
        .nullish(),
    }),
  }),
})

export const passkeyRenameRequest = z.object({ name: passkeyName })

/** `POST /api/auth/passkeys/options`: for `navigator.credentials.create`. */
export interface PasskeyCreationOptions {
  challenge: string
  rp: { id: string; name: string }
  user: { id: string; name: string; displayName: string }
  pubKeyCredParams: { type: 'public-key'; alg: number }[]
  timeout: number
  attestation: 'none'
  authenticatorSelection: {
    residentKey: 'required'
    requireResidentKey: true
    userVerification: 'required'
  }
  excludeCredentials: { type: 'public-key'; id: string; transports?: string[] }[]
}

/** `POST /api/auth/passkeys/login/options`: for `navigator.credentials.get`. */
export interface PasskeyRequestOptions {
  challenge: string
  rpId: string
  timeout: number
  userVerification: 'required'
}

/** A passkey as Settings lists it (`GET /api/auth/passkeys`, newest first). */
export interface PasskeyResponse {
  id: number
  name: string
  createdAt: number
  /** Last sign-in with it; null: never used yet. */
  lastUsedAt: number | null
}
