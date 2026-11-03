import { decodeExtras, type ExtrasSection, type GiEndgame } from '@gdt/shared'
import { loadBundle, type AccountRef } from '@/data/account-data'
import { capturedEndgame, type CapturedEndgame } from '@/data/endgame-runs'

export * from '@/data/endgame-runs'

/** The account's captured endgame runs (every snapshot's extras section, one bundle). */
export async function loadCapturedEndgame(a: AccountRef): Promise<CapturedEndgame> {
  const bundle = await loadBundle(a, { sections: ['extras'] })
  const decoded = new Map<string, GiEndgame | null>()
  const endgameOf = (key: string): GiEndgame | null => {
    let value = decoded.get(key)
    if (value === undefined) {
      const text = bundle.texts.get(key)
      value =
        text === undefined
          ? null
          : (decodeExtras(JSON.parse(text) as ExtrasSection).endgame ?? null)
      decoded.set(key, value)
    }
    return value
  }
  return capturedEndgame(
    bundle.snapshots.map((s) => ({
      takenAt: s.takenAt,
      endgame: s.extras ? endgameOf(s.extras) : null,
    })),
  )
}
