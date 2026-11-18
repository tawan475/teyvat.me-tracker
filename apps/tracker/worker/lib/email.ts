/**
 * Transactional email through Cloudflare Email Service: a `send_email` binding
 * named EMAIL (Workers Paid; the sender's domain must be onboarded to Email
 * Sending). The binding is optional. wrangler.jsonc leaves it out until the
 * domain is set up, and then nothing is sent: `emailEnabled` is false, the
 * settings say so, and "forgot password" still answers the same way.
 *
 * Above that sits one switch, the EMAIL_FEATURES var (paused, i.e. off,
 * unless it is "1"): off, no mail goes out even with the binding, an email
 * can't be added or changed, and the mail routes answer 404 (routes/recovery,
 * routes/auth). Admin reset links work either way.
 *
 * Mails carry one-time tokens: never log a message, only its outcome.
 */

import { configuredOrigin, originOf, SITE_ORIGIN } from './site'

/** Optional parts of the environment (not in wrangler.jsonc yet, so not in `Env`). */
interface EmailEnv {
  EMAIL?: SendEmail
  /** "1" turns the email features on; anything else (or unset) pauses them. */
  EMAIL_FEATURES?: string
  /** Sender address on the onboarded domain. */
  EMAIL_FROM?: string
  /** The site's origin, for links in mails (lib/site.ts). */
  SITE_URL?: string
}

export const BRAND = 'Teyvat.me'
export { SITE_ORIGIN }

/**
 * The address the site had before teyvat.me. It still serves the API
 * (installed irminsul copies post there) and sends pages on to SITE_ORIGIN
 * (index.html), so a request from it is still this site.
 */
export const OLD_SITE_ORIGIN = 'https://genshin-tracker.475.dev'
const DEFAULT_FROM = 'no-reply@475.dev'

const emailEnv = (env: Env) => env as unknown as EmailEnv

/** Whether the email features are on (EMAIL_FEATURES = "1"); paused otherwise. */
export const emailFeatures = (env: Env): boolean => emailEnv(env).EMAIL_FEATURES === '1'

/** The mail binding, while the email features are on. */
export function emailBinding(env: Env): SendEmail | undefined {
  if (!emailFeatures(env)) return undefined
  const binding = emailEnv(env).EMAIL
  // A binding is an object (an RPC stub under `vite dev`); a stray string var is not one.
  return binding && typeof binding !== 'string' ? binding : undefined
}

export const emailEnabled = (env: Env): boolean => emailBinding(env) !== undefined

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The origin links in a mail point at. The request's own origin only when it
 * is this site (SITE_URL, else the production origin or its old address) or loopback (`vite
 * dev`): a forged Host must never put a reset token in a link to someone
 * else's server. A loopback link sends the token to the reader's own machine,
 * which is why it is safe to allow.
 */
export function linkOrigin(env: Env, requestUrl: string): string {
  // A self-host: its SITE_URL, whatever the request says.
  const configured = configuredOrigin(env)
  if (configured) return configured
  const site = originOf(emailEnv(env).SITE_URL) ?? SITE_ORIGIN
  const request = originOf(requestUrl)
  if (request === site || request === SITE_ORIGIN || request === OLD_SITE_ORIGIN) return request
  if (request && LOOPBACK.has(new URL(request).hostname)) return request
  return site
}

/**
 * The origin of pages the API hands to irminsul (dashboard, device settings,
 * sign-in page): the request's own, except that the old address gives the
 * site's, since its pages are sent on to it. Not for OAuth redirect URIs:
 * those stay on the host whose cookie started the flow (`linkOrigin`).
 */
export function pageOrigin(env: Env, requestUrl: string): string {
  const configured = configuredOrigin(env)
  if (configured) return configured
  const request = new URL(requestUrl).origin
  if (request !== OLD_SITE_ORIGIN) return request
  return originOf(emailEnv(env).SITE_URL) ?? SITE_ORIGIN
}

export interface Mail {
  to: string
  subject: string
  text: string
  html: string
}

export type SendResult = 'sent' | 'unavailable' | 'failed'

/** Sends one mail. Never throws: a failure is logged (its code only) and reported. */
export async function sendMail(env: Env, mail: Mail): Promise<SendResult> {
  const binding = emailBinding(env)
  if (!binding) return 'unavailable'
  try {
    await binding.send({
      from: { name: BRAND, email: emailEnv(env).EMAIL_FROM || DEFAULT_FROM },
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    })
    return 'sent'
  } catch (error) {
    const code = (error as { code?: unknown })?.code
    console.error(
      'email send failed',
      typeof code === 'string' ? code : String(error).slice(0, 120),
    )
    return 'failed'
  }
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  )

/** A short mail: lines of text, an optional button link, a quiet footnote. */
function compose(
  to: string,
  subject: string,
  lines: string[],
  link: { href: string; label: string } | null,
  note: string,
): Mail {
  const text = [...lines, ...(link ? ['', link.href] : []), '', note, '', `— ${BRAND}`].join('\n')
  const paragraphs = lines
    .map((line) => `<p style="margin:0 0 16px">${escapeHtml(line)}</p>`)
    .join('')
  const button = link
    ? `<p style="margin:24px 0"><a href="${escapeHtml(link.href)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(link.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;color:#64748b;word-break:break-all">${escapeHtml(link.href)}</p>`
    : ''
  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;font-size:15px;line-height:1.5">` +
    `<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px">` +
    `<p style="margin:0 0 20px;font-weight:700;font-size:17px"><span style="color:#f59e0b">&#10022;</span> ${BRAND}</p>` +
    paragraphs +
    button +
    `<p style="margin:16px 0 0;font-size:13px;color:#64748b">${escapeHtml(note)}</p>` +
    `</div></body></html>`
  return { to, subject, text, html }
}

/**
 * Goes to an address nobody has confirmed yet, which anyone can type in: so
 * it carries nothing they chose (not even the username), only fixed text.
 */
export function verifyEmailMail(to: string, origin: string, token: string): Mail {
  return compose(
    to,
    'Confirm your email',
    [`Confirm this email for your ${BRAND} account.`],
    { href: `${origin}/verify-email?token=${token}`, label: 'Confirm email' },
    "The link works once, for 24 hours. Didn't ask for it? Ignore this email.",
  )
}

export function resetPasswordMail(
  to: string,
  origin: string,
  token: string,
  username: string,
): Mail {
  return compose(
    to,
    'Reset your password',
    [`Set a new password for ${username} on ${BRAND}.`],
    { href: `${origin}/reset-password?token=${token}`, label: 'Reset password' },
    "The link works once, for 30 minutes. Didn't ask for it? Ignore this email; your password stays as it is.",
  )
}

/**
 * A new way into the account: a linked Discord / Google account, or a first
 * password. Only to a confirmed email.
 */
export function signInAddedMail(to: string, origin: string, username: string, what: string): Mail {
  return compose(
    to,
    `${what} added to your account`,
    [`${what} can now be used to sign in to ${username} on ${BRAND}.`],
    { href: `${origin}/app/settings`, label: "Wasn't you? Review it" },
    'Sent to the confirmed email of this account.',
  )
}

export function passwordChangedMail(to: string, origin: string, username: string): Mail {
  return compose(
    to,
    'Your password was changed',
    [`The password for ${username} on ${BRAND} was just changed, and every device was signed out.`],
    { href: `${origin}/forgot-password`, label: "Wasn't you? Reset it" },
    'Sent to the confirmed email of this account.',
  )
}
