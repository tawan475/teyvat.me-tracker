import type { SessionMethod, SessionResponse } from '@gdt/shared'
import type { Component } from 'vue'
import { Fingerprint, History, KeyRound, LifeBuoy, Monitor, Smartphone } from 'lucide-vue-next'
import { t } from '@/i18n'
import { describeUserAgent } from '@/lib/user-agent'

/** How a session signed in: an icon (Discord and Google show their marks). */
export const METHOD_ICONS: Record<SessionMethod, Component | undefined> = {
  password: KeyRound,
  discord: undefined,
  google: undefined,
  reset: LifeBuoy,
  legacy: History,
  irminsul: Monitor,
  passkey: Fingerprint,
}

export const methodTitle = (method: SessionMethod): string => t(`settings.devices.method.${method}`)

/** A session as these helpers read it (the owner's list and staff's). */
type SessionLike = Pick<SessionResponse, 'method' | 'userAgent' | 'deviceName'>

/**
 * Whether a session is on a phone. A browser says so in its user agent; a
 * capture app's sign-in has only its device name, and a PC's (its host
 * name) never holds a space, while Teyvat.me for Android sends the maker
 * and model ("samsung SM-A546E", "Pixel 8"). A guess for a list, nothing else.
 */
export function onPhone(row: SessionLike): boolean {
  if (row.method === 'irminsul') return /\s/.test(row.deviceName?.trim() ?? '')
  return /\b(?:iPhone|Android|Mobile)\b/.test(row.userAgent ?? '')
}

/** The capture apps' sign-ins on a phone get the phone. */
export const methodIcon = (row: SessionLike): Component | undefined =>
  row.method === 'irminsul' && onPhone(row) ? Smartphone : METHOD_ICONS[row.method]

/**
 * "Teyvat.me on <device>" for the capture apps (irminsul is retired: its
 * sign-ins read the same), the browser and system otherwise.
 */
export function deviceName(row: SessionLike): string {
  if (row.method !== 'irminsul') return describeUserAgent(row.userAgent)
  return t('settings.devices.teyvatmeOn', { device: row.deviceName || t('settings.devices.aPc') })
}

/** "IP · City, CC", or '' when neither is known. */
export function devicePlace(row: SessionResponse): string {
  return [row.ip, [row.city, row.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
}

/** This device first, then the most recently seen. */
export function byRecent(a: SessionResponse, b: SessionResponse): number {
  return Number(b.current) - Number(a.current) || b.lastSeenAt - a.lastSeenAt
}
