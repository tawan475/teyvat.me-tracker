import {
  decodeExtras,
  decodeTasks,
  type ExtrasSection,
  type GiEndgame,
  type TasksSection,
} from '@gdt/shared'
import { loadBundle, type AccountRef } from '@/data/account-data'
import { capturedEndgame, type CapturedEndgame, type GiAbyssRun } from '@/data/endgame-runs'

export * from '@/data/endgame-runs'

/**
 * The account's captured endgame runs: every snapshot's extras section
 * (gi_endgame) and tasks section (gi_tasks.abyss), one bundle, each distinct
 * section decoded once.
 */
export async function loadCapturedEndgame(a: AccountRef): Promise<CapturedEndgame> {
  const bundle = await loadBundle(a, { sections: ['extras', 'tasks'] })
  const once = <T>(cache: Map<string, T | null>, key: string, read: (text: string) => T | null) => {
    let value = cache.get(key)
    if (value === undefined) {
      const text = bundle.texts.get(key)
      value = text === undefined ? null : read(text)
      cache.set(key, value)
    }
    return value
  }
  const endgames = new Map<string, GiEndgame | null>()
  const abysses = new Map<string, GiAbyssRun | null>()
  return capturedEndgame(
    bundle.snapshots.map((s) => ({
      takenAt: s.takenAt,
      endgame: s.extras
        ? once(
            endgames,
            s.extras,
            (text) => decodeExtras(JSON.parse(text) as ExtrasSection).endgame ?? null,
          )
        : null,
      abyss: s.tasks
        ? once(
            abysses,
            s.tasks,
            (text) => decodeTasks(JSON.parse(text) as TasksSection).abyss ?? null,
          )
        : null,
    })),
  )
}
