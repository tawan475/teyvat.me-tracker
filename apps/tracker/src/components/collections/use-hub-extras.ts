import { computed, onBeforeUnmount, ref } from 'vue'
import { loadAchievements, loadAnecdotes } from '@gdt/game-data'
import { useAchievementMarks } from '@/components/achievements/use-achievement-marks'
import { useAnecdoteMarks } from '@/components/anecdotes/use-anecdote-marks'
import { NO_CAPTURED_ACHIEVEMENTS, loadCapturedAchievements } from '@/data/achievement-capture'
import { groupAchievements, summarizeAchievements } from '@/data/achievement-progress'
import { loadCapturedAnecdotes } from '@/data/anecdote-capture'
import { loadCapturedEndgame, NO_CAPTURED_ENDGAME } from '@/data/endgame-capture'
import { loadEndgameData } from '@/data/endgame'
import { arcanaSummary, arcanaViews } from '@/data/lunar-arcana'
import { NO_CAPTURED_ANECDOTES, anecdoteProgress } from '@/data/anecdote-progress'
import type { CollectionFigure } from '@/data/collection-summary'
import { useResource } from '@/data/use-resource'
import { useAccount, useReadOnly } from '@/views/account/context'

export interface HubExtra {
  figure: CollectionFigure | null
  takenAt: number | null
}

/**
 * The hub's Achievements and Anecdotes cards, counted as their pages count:
 * done = the newest capture's plus those marked by hand, of the game data's
 * total. Null figures until the data and the marks have loaded; `ready`
 * once both are in, or after READY_CAP_MS (a failed load must not hold the
 * hub back), so the hub shows every card at once.
 */
export function useHubExtras() {
  const account = useAccount()
  const readOnly = useReadOnly()

  const achievements = useResource(
    () => account.value,
    async (a) => {
      const [data, captured] = await Promise.all([
        loadAchievements(),
        a.latest ? loadCapturedAchievements(a) : NO_CAPTURED_ACHIEVEMENTS,
      ])
      return { accountId: a.id, entries: groupAchievements(data), byId: data.byId, captured }
    },
  )
  const achievementMarks = useAchievementMarks(() => account.value.id)

  const anecdotes = useResource(
    () => account.value,
    async (a) => {
      const [data, captured] = await Promise.all([
        loadAnecdotes(),
        a.latest ? loadCapturedAnecdotes(a) : NO_CAPTURED_ANECDOTES,
      ])
      return { accountId: a.id, data, captured }
    },
  )
  const anecdoteMarks = useAnecdoteMarks(() => account.value.id, readOnly)

  const achievement = computed<HubExtra>(() => {
    const value = achievements.data.value
    if (
      !value ||
      value.accountId !== account.value.id ||
      achievementMarks.loadedFor.value !== account.value.id
    )
      return { figure: null, takenAt: null }
    const summary = summarizeAchievements(
      value.entries,
      { captured: value.captured.ids, marked: achievementMarks.marked.value },
      value.byId,
    )
    return {
      figure: { have: summary.done, total: summary.total },
      takenAt: value.captured.takenAt,
    }
  })

  const anecdote = computed<HubExtra>(() => {
    const value = anecdotes.data.value
    if (
      !value ||
      value.accountId !== account.value.id ||
      anecdoteMarks.loadedFor.value !== account.value.id
    )
      return { figure: null, takenAt: null }
    const progress = anecdoteProgress(value.data, value.captured, anecdoteMarks.marked.value)
    return {
      figure: { have: progress.done, total: progress.total },
      takenAt: value.captured.takenAt,
    }
  })

  // Lunar Arcana: different cards held of all, from the newest capture that sent them
  // (Capture 1.17.31 on); no figure before one did. Not waited for (`ready`).
  const arcanaData = useResource(
    () => account.value,
    async (a) => {
      const [game, captured] = await Promise.all([
        loadEndgameData('en'),
        a.latest ? loadCapturedEndgame(a) : NO_CAPTURED_ENDGAME,
      ])
      return { accountId: a.id, cards: game.data.arcana, arcana: captured.arcana }
    },
  )
  const arcana = computed<HubExtra>(() => {
    const value = arcanaData.data.value
    if (!value || value.accountId !== account.value.id || !value.arcana)
      return { figure: null, takenAt: null }
    const summary = arcanaSummary(arcanaViews(value.cards, value.arcana.held))
    return {
      figure: { have: summary.held ?? 0, total: summary.total },
      takenAt: value.arcana.takenAt,
    }
  })

  const capped = ref(false)
  const timer = setTimeout(() => (capped.value = true), READY_CAP_MS)
  onBeforeUnmount(() => clearTimeout(timer))
  const ready = computed(
    () => capped.value || (achievement.value.figure !== null && anecdote.value.figure !== null),
  )

  return { achievement, anecdote, arcana, ready }
}

export type HubExtras = ReturnType<typeof useHubExtras>

/** How long the hub waits for the Achievements and Anecdotes figures at most. */
const READY_CAP_MS = 2000
