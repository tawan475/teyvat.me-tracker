import {
  ACCOUNT_SETTINGS_DEFAULTS,
  type AccountSettings,
  type PartNotes,
  type RemovablePart,
} from '@gdt/shared'
import { computed, shallowRef, watch, type ComputedRef } from 'vue'
import { api } from '@/api'
import { onPlannerChange } from '@/live/planner-changes'
import { loadAccountSettings, seedAccountSettings } from './account-settings'

/**
 * The account's part notes (settings `parts`, issue 12): when the owner hid
 * a "Not shared by Capture" note and when they removed a part from history.
 * Read with the settings (one cache), re-read when they change elsewhere
 * (the live `planner` event every settings write sends).
 */
const known = shallowRef(new Map<number, PartNotes>())

function set(id: number, notes: PartNotes | undefined): void {
  const next = new Map(known.value)
  next.set(id, notes ?? ACCOUNT_SETTINGS_DEFAULTS.parts)
  known.value = next
}

async function load(id: number, fresh = false): Promise<void> {
  try {
    set(id, (await loadAccountSettings(id, { fresh })).parts)
  } catch {
    // No notes: the strips still say what the captures say.
  }
}

onPlannerChange((id) => {
  if (known.value.has(id)) void load(id, true)
})

/** The account's notes; null until read. */
export function usePartNotes(accountId: () => number): ComputedRef<PartNotes | null> {
  watch(accountId, (id) => void load(id), { immediate: true })
  return computed(() => known.value.get(accountId()) ?? null)
}

/** Hides a note (a part's, or Overview's `all`) until it changes. */
export async function hidePartNote(id: number, key: RemovablePart | 'all'): Promise<void> {
  const { settings } = await api.hidePartNote(id, key)
  seedAccountSettings(id, settings as AccountSettings)
  set(id, settings.parts)
}

/** A removal this tab made: the pages say so at once. */
export function markPartRemoved(id: number, part: RemovablePart, at: number): void {
  const current = known.value.get(id) ?? ACCOUNT_SETTINGS_DEFAULTS.parts
  set(id, { ...current, removed: { ...current.removed, [part]: at } })
  void load(id, true)
}
