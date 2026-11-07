/**
 * The signed-in user's passkeys, shared by Settings' Passkeys panel
 * (desktop) and the Connected accounts card (phones list them inside it,
 * the user's pick), so one load serves both, with the actions both offer.
 * Never removes the last way in (the server refuses it too, 409
 * `last_sign_in`).
 */

import type { PasskeyResponse } from '@gdt/shared'
import { computed, ref } from 'vue'
import { ApiRequestError, api } from '@/api'
import { loadSignInOptions } from '@/components/oauth/oauth'
import { t, te } from '@/i18n'
import { createPasskey, passkeysSupported } from '@/lib/passkeys'
import { markPasskeyMade } from '@/lib/passkey-nudge-store'
import { useFeedback } from '@/stores/feedback'
import { useSession } from '@/stores/session'

const list = ref<PasskeyResponse[] | null>(null)
const failed = ref(false)
/** This host has passkeys (teyvat.me, localhost) and this browser has WebAuthn. */
const available = ref(false)
/** Linked Discord / Google accounts, as the Connected accounts card last read them. */
const identityCount = ref<number | null>(null)
/** What is in flight: 'add', or the id of the passkey being changed. */
const busy = ref<'add' | number | null>(null)
let loading: Promise<void> | null = null

async function load(): Promise<void> {
  const [options, rows] = await Promise.all([loadSignInOptions(), api.passkeys().catch(() => null)])
  available.value = options.passkeys && passkeysSupported()
  failed.value = rows === null
  if (rows) list.value = rows
}

const reload = (): Promise<void> => (loading ??= load().finally(() => (loading = null)))

/**
 * A passkey error as the user reads it: the browser's "this device has one
 * already", and the server's ceremony codes that have no text of their own.
 */
export function passkeyCause(cause: unknown): unknown {
  if (cause instanceof DOMException && cause.name === 'InvalidStateError') {
    return new Error(t('errors.api.passkey_exists'))
  }
  if (
    cause instanceof ApiRequestError &&
    cause.code.startsWith('passkey_') &&
    !te(`errors.api.${cause.code}`)
  ) {
    return new Error(t('errors.api.passkey_failed'))
  }
  return cause
}

export function usePasskeys() {
  const session = useSession()
  const feedback = useFeedback()
  if (list.value === null) void reload()

  /** Removing one passkey still leaves a way in. */
  const canRemove = computed(
    () =>
      session.me?.hasPassword === true ||
      (identityCount.value ?? 1) > 0 ||
      (list.value?.length ?? 0) > 1,
  )

  async function add(): Promise<void> {
    busy.value = 'add'
    try {
      const made = await createPasskey()
      if (!made) return
      list.value = [made, ...(list.value ?? [])]
      markPasskeyMade()
      feedback.toast({ tone: 'success', title: t('settings.passkeys.added') })
    } catch (cause) {
      feedback.error(t('settings.passkeys.notAdded'), passkeyCause(cause))
    } finally {
      busy.value = null
    }
  }

  async function rename(row: PasskeyResponse, name: string): Promise<boolean> {
    const trimmed = name.trim()
    if (!trimmed || trimmed === row.name) return true
    busy.value = row.id
    try {
      const updated = await api.renamePasskey(row.id, trimmed.slice(0, 64))
      list.value = (list.value ?? []).map((item) => (item.id === row.id ? updated : item))
      return true
    } catch (cause) {
      feedback.error(t('settings.passkeys.notRenamed'), cause)
      return false
    } finally {
      busy.value = null
    }
  }

  async function remove(row: PasskeyResponse): Promise<void> {
    const ok = await feedback.confirm({
      title: t('settings.passkeys.removeTitle', { name: row.name }),
      detail: t('settings.passkeys.removeDetail'),
      confirmLabel: t('common.remove'),
      tone: 'danger',
    })
    if (!ok) return
    busy.value = row.id
    try {
      await api.removePasskey(row.id)
      list.value = (list.value ?? []).filter((item) => item.id !== row.id)
      feedback.toast({ tone: 'success', title: t('settings.passkeys.removed') })
    } catch (cause) {
      feedback.error(t('settings.passkeys.notRemoved'), cause)
      await reload()
    } finally {
      busy.value = null
    }
  }

  return {
    list,
    failed,
    available,
    identityCount,
    busy,
    canRemove,
    /** Shown at all: passkeys work here, or the user already has some. */
    shown: computed(() => available.value || (list.value?.length ?? 0) > 0),
    add,
    rename,
    remove,
    reload,
  }
}
