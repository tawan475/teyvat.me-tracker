// Startup code: the zod-free modules, not the package index (its schemas).
import { OAUTH_PROVIDERS, OAUTH_PROVIDER_LABELS, type OAuthProvider } from '@gdt/shared/oauth'
import { SIGNUP_MODES, type SignupMode } from '@gdt/shared/permissions'
import { api } from '@/api'
import { t } from '@/i18n'

export const providerLabel = (provider: OAuthProvider): string => OAUTH_PROVIDER_LABELS[provider]

export function isProvider(value: unknown): value is OAuthProvider {
  return typeof value === 'string' && (OAUTH_PROVIDERS as readonly string[]).includes(value)
}

/**
 * What the signed-out pages offer: the server's providers, whether email
 * features are on, the human check's site key (null while it is off), and
 * who may sign up (the staff switch).
 */
export interface SignInOptions {
  providers: OAuthProvider[]
  emailFeatures: boolean
  turnstileSiteKey: string | null
  signups: SignupMode
  /** Passkeys work on this host (teyvat.me, localhost). */
  passkeys: boolean
}

let options: Promise<SignInOptions> | null = null

/**
 * The server's sign-in options, asked once per page load (`fresh`: again,
 * as when the server asked for a human check this page didn't know of):
 * providers (none until their secrets are set), the email switch (off when
 * unsure) and the human check's site key.
 */
export function loadSignInOptions(fresh = false): Promise<SignInOptions> {
  if (fresh) options = null
  options ??= api
    .oauthProviders()
    .then((response) => ({
      providers: response.providers.filter(isProvider),
      emailFeatures: response.emailFeatures === true,
      turnstileSiteKey:
        typeof response.turnstileSiteKey === 'string' && response.turnstileSiteKey
          ? response.turnstileSiteKey
          : null,
      // An older Worker doesn't say: sign-ups are open there.
      signups: (SIGNUP_MODES as readonly string[]).includes(response.signups)
        ? response.signups
        : 'open',
      passkeys: response.passkeys === true,
    }))
    .catch(() => {
      options = null
      return {
        providers: [],
        emailFeatures: false,
        turnstileSiteKey: null,
        signups: 'open' as const,
        passkeys: false,
      }
    })
  return options
}

/** "Discord or Google": the providers named for a line of text. */
export const providerNames = (providers: readonly OAuthProvider[]): string =>
  providers.map(providerLabel).join(t('auth.oauth.providerJoin'))

/** What a provider round trip's `?oauth_error=` code means, in a few words. */
export function oauthErrorText(code: unknown): string {
  switch (code) {
    case 'unavailable':
      return t('auth.oauth.error.unavailable')
    case 'state':
      return t('auth.oauth.error.state')
    case 'expired':
      return t('auth.oauth.error.expired')
    case 'denied':
      return t('auth.oauth.error.denied')
    case 'session':
      return t('auth.oauth.error.session')
    case 'taken':
      return t('auth.oauth.error.taken')
    case 'already':
      return t('auth.oauth.error.already')
    case 'rate_limited':
      return t('auth.oauth.error.rateLimited')
    case 'suspended':
      return t('auth.oauth.error.suspended')
    default:
      return t('auth.oauth.error.failed')
  }
}
