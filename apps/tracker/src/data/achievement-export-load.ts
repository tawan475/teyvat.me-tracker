import { loadAchievements } from '@gdt/game-data'
import type { AccountRef } from './account-data'
import { NO_CAPTURED_ACHIEVEMENTS, loadCapturedAchievements } from './achievement-capture'
import type { AchievementExportInput } from './achievement-export'

/**
 * The export's input for an account as the page reads it: its captures (cut
 * and without the live journal in time travel) and the game data. `marked`
 * is the page's list (`useAchievementMarks`, read as of the capture in time
 * travel).
 */
export async function loadAchievementExport(
  account: AccountRef & { latest?: { id: number } | null },
  marked: ReadonlySet<number>,
): Promise<AchievementExportInput> {
  const [captured, data] = await Promise.all([
    account.latest ? loadCapturedAchievements(account) : NO_CAPTURED_ACHIEVEMENTS,
    loadAchievements(),
  ])
  return { captured, marked, known: data.byId }
}
