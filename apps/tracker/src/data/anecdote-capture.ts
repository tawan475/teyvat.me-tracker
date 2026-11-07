import { decodeAnecdotes as decodeAnecdotesSection, type AnecdotesSection } from '@gdt/shared'
import { loadBundle, loadLive, type AccountRef } from '@/data/account-data'
import {
  NO_CAPTURED_ANECDOTES,
  capturedAnecdotes,
  type CapturedAnecdotes,
} from '@/data/anecdote-progress'
import { withLiveParts } from '@/data/live-now'

/**
 * The newest capture's anecdotes (the Anecdotes page and the Collections
 * hub's card), with what Capture sent since (live sync) applied.
 */
export async function loadCapturedAnecdotes(
  a: AccountRef & { latest?: { id: number } | null },
): Promise<CapturedAnecdotes> {
  const [bundle, live] = await Promise.all([
    loadBundle(a, { sections: ['anecdotes'] }),
    loadLive(a).catch(() => null),
  ])
  // Oldest first: the newest snapshot that has them.
  const newest = [...bundle.snapshots].reverse().find((s) => s.anecdotes)
  const text = newest?.anecdotes ? bundle.texts.get(newest.anecdotes) : undefined
  const stored =
    newest && text !== undefined
      ? decodeAnecdotesSection(JSON.parse(text) as AnecdotesSection)
      : undefined
  // The journal follows the newest snapshot, whether or not it has anecdotes.
  const latestId = a.latest?.id ?? null
  const now = withLiveParts(stored ? { gi_anecdotes: stored } : {}, live, latestId, [
    'anecdotes',
    'gi_anecdotes',
  ]).gi_anecdotes
  if (!now) return NO_CAPTURED_ANECDOTES
  const takenAt = now === stored ? newest!.takenAt : (live?.updatedAt ?? newest?.takenAt ?? null)
  return capturedAnecdotes(now, takenAt)
}
