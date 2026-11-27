import { defineAsyncComponent, type Component } from 'vue'
import { Dices, FerrisWheel, Layers, Target } from 'lucide-vue-next'
import type { MessageSchema } from '@/i18n'

/**
 * The Fun section's sub-pages (docs/plans/fun.md), in the hub's order. The
 * slug is the URL's last segment (`/fun/team-randomizer`). A new idea is one
 * row here, its component and its messages (`fun.pages.<label>`): the route
 * takes any slug and FunView shows the hub for one it does not know, so the
 * router is never touched.
 */
export interface FunPage {
  slug: string
  /** Its messages: `fun.pages.<label>.title` and `.pitch`. */
  label: keyof MessageSchema['fun']['pages']
  icon: Component
  /** Loaded when the page is first shown. */
  component: Component
  /** The day it was added (ISO date): "New" on its card for NEW_DAYS. */
  added: string
}

export const FUN_PAGES: readonly FunPage[] = [
  {
    slug: 'team-randomizer',
    label: 'teamRandomizer',
    icon: Dices,
    component: defineAsyncComponent(() => import('./randomizer/TeamRandomizer.vue')),
    added: '2026-11-24',
  },
  {
    slug: 'boss-randomizer',
    label: 'bossRandomizer',
    icon: Target,
    component: defineAsyncComponent(() => import('./boss/BossRandomizer.vue')),
    added: '2026-11-27',
  },
  {
    slug: 'challenge-cards',
    label: 'challengeCards',
    icon: Layers,
    component: defineAsyncComponent(() => import('./cards/ChallengeCards.vue')),
    added: '2026-11-27',
  },
  {
    slug: 'wheel',
    label: 'wheel',
    icon: FerrisWheel,
    component: defineAsyncComponent(() => import('./wheel/WheelPage.vue')),
    added: '2026-11-27',
  },
]

export const funPage = (slug: unknown): FunPage | null =>
  FUN_PAGES.find((page) => page.slug === slug) ?? null

const NEW_DAYS = 30

/** Whether the page's card still says "New" at `now` (ms). */
export function isNewPage(page: FunPage, now: number): boolean {
  const added = Date.parse(page.added)
  return now >= added && now - added < NEW_DAYS * 86_400_000
}
