import {
  decodeAchievementTimes,
  decodeAchievements,
  decodeProgress,
  type AchievementTimesSection,
} from '@gdt/shared'
import { loadBundle, loadLive, type AccountRef } from '@/data/account-data'
import {
  captureAchievements,
  withLiveAchievements,
  type CapturedAchievements,
} from '@/data/achievement-progress'

/**
 * What the captures say about achievements (the Achievements page and the
 * Collections hub's card): done ids, times, and the newest progress on the
 * unfinished ones (Capture 1.7.0). One bundle of those sections.
 */
export const NO_CAPTURED_ACHIEVEMENTS: CapturedAchievements = {
  ids: new Set(),
  takenAt: null,
  firstTakenAt: null,
  firstSeen: new Map(),
  lastMissing: new Map(),
  completedAt: new Map(),
}

export async function loadCapturedAchievements(
  a: AccountRef & { latest?: { id: number } | null },
): Promise<CapturedAchievements> {
  const bundle = await loadBundle(a, {
    sections: ['achievements', 'achievementTimes', 'progress'],
  })
  const json = (key: string) => {
    const text = bundle.texts.get(key)
    return text === undefined ? null : JSON.parse(text)
  }
  // Capture 1.7.0: the newest snapshot's progress on unfinished ones.
  const withProgress = [...bundle.snapshots].reverse().find((s) => s.progress)
  const parts = withProgress?.progress ? decodeProgress(json(withProgress.progress)) : null
  const progress = parts?.achievementProgress
    ? new Map(Object.entries(parts.achievementProgress).map(([id, p]) => [Number(id), p]))
    : undefined
  const captured = captureAchievements(
    bundle.snapshots.map((s) => ({
      takenAt: s.takenAt,
      key: s.achievements,
      timesKey: s.achievementTimes,
    })),
    (key) => decodeAchievements(json(key) ?? []),
    (key) => {
      // A delta names its full base, which the bundle carries along.
      const section: AchievementTimesSection = json(key) ?? { i: [], t: [] }
      return decodeAchievementTimes(section, section.b ? json(section.b) : null)
    },
  )
  const snapshots = progress ? { ...captured, progress } : captured
  // Live sync: achievements finished since the newest snapshot (Capture 1.15.5).
  const live = await loadLive(a).catch(() => null)
  return withLiveAchievements(snapshots, live, a.latest?.id ?? null)
}
