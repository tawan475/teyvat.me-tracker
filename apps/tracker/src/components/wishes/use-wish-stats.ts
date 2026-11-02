import { computed, type Ref } from 'vue'
import type { UigfGachaType } from '@gdt/shared'
import { useResource } from '@/data/use-resource'
import {
  bannerStats,
  eventBanners,
  type BannerFile,
  type BannerStats,
  type WishHistory,
} from '@/data/wish-history'
import { loadGameIcons } from '@/lib/assets'
import { WISH_BANNERS } from './wish-labels'

let bannerFile: Promise<BannerFile> | null = null

/** Banner dates and featured items (paimon.moe's data, MIT) and the icon names: one cached load. */
export function loadBannerFile(): Promise<BannerFile> {
  bannerFile ??= Promise.all([
    import('@/data/wish-banners.json').then((m) => m.default as unknown as BannerFile),
    loadGameIcons(),
  ]).then(([file]) => file)
  bannerFile.catch(() => (bannerFile = null))
  return bannerFile
}

/**
 * Figures per history, shared by the pages: the overview and a banner's page
 * opened after it reuse them instead of counting 18,000 pulls again.
 */
const computedStats = new WeakMap<WishHistory, Map<UigfGachaType, BannerStats>>()

function statsOf(history: WishHistory, file: BannerFile): Map<UigfGachaType, BannerStats> {
  let out = computedStats.get(history)
  if (out) return out
  const events = eventBanners(file, history.timezone)
  out = new Map<UigfGachaType, BannerStats>()
  for (const { banner } of WISH_BANNERS) {
    out.set(
      banner,
      bannerStats(banner, history.banners.get(banner) ?? [], {
        timezone: history.timezone,
        banners: events,
      }),
    )
  }
  computedStats.set(history, out)
  return out
}

/** Every banner's figures, computed once per history (the banner data loads once). */
export function useWishStats(history: Ref<WishHistory | undefined>) {
  const file = useResource(() => 0, loadBannerFile)
  const stats = computed(() => {
    const h = history.value
    const f = file.data.value
    return h && f ? statsOf(h, f) : null
  })
  return { stats, error: file.error, reload: file.reload }
}
