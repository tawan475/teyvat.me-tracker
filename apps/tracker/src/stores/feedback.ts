import { defineStore } from 'pinia'
import { ref } from 'vue'
import { errorText } from '@/i18n/api-errors'

export interface Toast {
  id: number
  /** `pause`: something waits on the user (a watched folder after a reload). */
  tone: 'info' | 'success' | 'danger' | 'pause'
  title: string
  detail?: string
  /** Tooltip with the specifics (e.g. which capture, when); a visible line on phones. */
  hint?: string
  /** The specifics as lines for phones (no hover); the tooltip too when there is no `hint`. */
  lines?: { text: string; code?: boolean }[]
  action?: { label: string; run: () => void }
  /** What ✕ means here, when not just Dismiss (e.g. "Not now"). */
  closeLabel?: string
}

export interface ConfirmRequest {
  title: string
  /** What is lost and where, in plain words (not "this cannot be undone"). */
  detail: string
  confirmLabel: string
  tone?: 'danger' | 'default'
  resolve: (ok: boolean) => void
}

/** Toasts and confirm dialogs, rendered once by the app shell. */
export const useFeedback = defineStore('feedback', () => {
  const toasts = ref<Toast[]>([])
  const confirmation = ref<ConfirmRequest | null>(null)
  let nextId = 1

  /** Shows a toast for `ms` (danger 8 s, else 4.5 s; 0 = until answered); returns its id. */
  function toast(input: Omit<Toast, 'id'>, ms = input.tone === 'danger' ? 8000 : 4500) {
    const id = nextId++
    toasts.value.push({ ...input, id })
    if (ms > 0) setTimeout(() => dismiss(id), ms)
    return id
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  /**
   * Shows an error from any thrown value; ApiRequestError messages are safe to
   * show (in Chinese, the message for the server's code: i18n/api-errors).
   */
  function error(title: string, cause?: unknown) {
    const detail = cause instanceof Error ? errorText(cause) : undefined
    return toast({ tone: 'danger', title, detail })
  }

  function confirm(request: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
    confirmation.value?.resolve(false)
    return new Promise((resolve) => {
      confirmation.value = { ...request, resolve }
    })
  }

  function settle(ok: boolean) {
    confirmation.value?.resolve(ok)
    confirmation.value = null
  }

  return { toasts, confirmation, toast, dismiss, error, confirm, settle }
})
