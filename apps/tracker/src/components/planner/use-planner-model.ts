import { loadPlanner } from '@gdt/game-data'
import { loadDropRates } from '@gdt/game-data/drops'
import { loadFarming } from '@gdt/game-data/farming'
import { createRequirementCache, planTotals, type PlanOptions } from '@gdt/game-data/planner-math'
import type { AccountResponse, CustomCharacter, CustomWeapon, Good } from '@gdt/shared'
import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue'
import { NO_PLAYER } from '@/data/account-player'
import { clockReading, liveReading } from './resin'
import { loadAccountPlayer, loadLatestInventory } from '@/data/account-data'
import type { CapturedTasks } from './tasks'
import { usePlannerSettings } from '@/data/planner-settings'
import { useResource } from '@/data/use-resource'
import { localizeFarming } from '@/i18n/localize-farming'
import { loadGameIcons, loadMaterialIcons } from '@/lib/assets'
import { readStorage, writeStorage } from '@/lib/storage'
import { updatesHeld } from '@/live/holds'
import { onPlannerChange } from '@/live/planner-changes'
import { useAccounts } from '@/stores/accounts'
import { preloadMaterialRarities } from '@/utils/materials'
import { countChange, effectiveInventory, replacedAdjustments } from './hand-edits'
import { withCustomCharacters } from './custom-character'
import { setCustomProfiles } from './custom-registry'
import { withCustomWeapons } from './custom-weapon'
import { keepUnchanged } from './keep-unchanged'
import { buildBoard, withoutGems, type Board } from './model'
import { usePlannerState } from './use-planner-state'
import { usePlannerTargets } from './use-planner-targets'
import { usePlannerTasks } from './use-planner-tasks'

const NO_CAPTURE: Good = {
  format: 'GOOD',
  version: 3,
  source: '',
  characters: [],
  artifacts: [],
  weapons: [],
  materials: {},
}

/**
 * The planner's data for one account, shared by the Planner and the
 * Materials page (whose tiles open the same inventory editor): the newest
 * capture, the planner data and drop rates, the goals and the hand edits
 * (each with its optimistic store), the bag they make (capture + edits that
 * still apply), the settings and the totals against the bag.
 *
 * Goals and hand edits changed in another tab or device are re-read once
 * this tab is shown and nothing is open (data never changes under a dialog).
 *
 * `planner` is the planner data with the account's custom characters in it
 * (custom-character.ts), so they cost like any other; `basePlanner` is the
 * game's alone (the roster to pick from, the Seelie import). With `tasks`
 * (the Planner), the account's tasks come along in their own store.
 */
export function usePlannerModel(
  account: ComputedRef<AccountResponse>,
  options: { tasks?: boolean } = {},
) {
  const accounts = useAccounts()
  const accountId = computed(() => account.value.id)
  /** The capture hand edits are made against: the newest one's last sighting, 0 for none. */
  const base = computed(() => account.value.latest?.lastSeenAt ?? 0)

  const resource = useResource(
    () => account.value,
    async (a) => {
      const [inventory, planner, drops, player, farming] = await Promise.all([
        a.latest ? loadLatestInventory(a) : Promise.resolve(null),
        loadPlanner(),
        // No rates means no estimates, not a broken page.
        loadDropRates().catch(() => null),
        // Nice to have: without it the settings (or the top bracket) decide.
        a.latest ? loadAccountPlayer(a).catch(() => NO_PLAYER) : Promise.resolve(NO_PLAYER),
        // Who drops what (farm card names, artifact domains); without it the cards have no places.
        loadFarming().catch(() => null),
        loadGameIcons(),
        loadMaterialIcons(),
        // The game's rarity for every material's backdrop (the icons' chunk;
        // the planner data has 0 for local specialties).
        preloadMaterialRarities(),
      ])
      return { accountId: a.id, inventory, planner, drops, player, farming }
    },
  )
  const data = computed(() => {
    const value = resource.data.value
    return value && value.accountId === account.value.id ? value : undefined
  })
  const basePlanner = computed(() => data.value?.planner ?? null)
  /** The newest capture (an empty one when there is none). */
  const good = computed(() => (data.value ? (data.value.inventory?.good ?? NO_CAPTURE) : null))
  const drops = computed(() => data.value?.drops ?? null)
  // Names in the language on screen (rebuilt on a switch).
  const farming = computed(() => {
    const loaded = data.value?.farming
    return loaded ? localizeFarming(loaded) : null
  })
  const hasCapture = computed(() => !!data.value?.inventory)
  /** irminsul's `gi_tasks` in the newest capture, with when it was taken. */
  const capturedTasks = computed<CapturedTasks | null>(() => {
    const inventory = data.value?.inventory
    const tasks = inventory?.good.gi_tasks
    const ar = inventory?.good.gi_player?.ar
    const live = inventory?.live
    return inventory && tasks
      ? {
          at: inventory.snapshot.takenAt,
          tasks,
          ...(ar !== undefined ? { ar } : {}),
          ...(live?.tasks.length ? { live: { parts: live.tasks, at: live.updatedAt } } : {}),
        }
      : null
  })

  const store = usePlannerTargets(accountId)
  onBeforeUnmount(() => void store.flush())

  /** Custom characters and weapons as text: the planner below changes only when one does. */
  watch(
    () => store.targets.value,
    (targets) => setCustomProfiles(targets ?? []),
    {
      immediate: true,
    },
  )
  const customs = computed(() => {
    const targets = store.targets.value ?? []
    return JSON.stringify({
      characters: targets.flatMap((t) => (t.kind === 'custom' ? [[t.key, t.target.custom]] : [])),
      weapons: targets.flatMap((t) =>
        t.kind === 'weapon' && t.target.custom ? [[t.key, t.target.custom]] : [],
      ),
    })
  })
  const planner = computed(() => {
    const p = basePlanner.value
    if (!p) return null
    const { characters, weapons } = JSON.parse(customs.value) as {
      characters: [string, CustomCharacter][]
      weapons: [string, CustomWeapon][]
    }
    return withCustomWeapons(withCustomCharacters(p, characters), weapons)
  })

  const state = usePlannerState(
    accountId,
    base,
    async (id) => {
      // The page's account is behind the server: bring it up to date now.
      await accounts.reload(id).catch(() => {})
      accounts.applyPending(true)
    },
    // A new goal's current state needs the goal on the server first.
    () => store.flush(),
  )
  onBeforeUnmount(() => void state.flush())

  /**
   * Hand edits that still count: live sync's journal supersedes an older
   * edit of a material it changed, as a newer capture supersedes every one.
   */
  const liveEdits = computed(() => {
    const edits = state.adjustments.value
    const live = data.value?.inventory?.live
    if (!edits || !live?.materials.length) return edits
    const touched = new Set(live.materials)
    return edits.filter((edit) => !(touched.has(edit.key) && edit.updatedAt < live.updatedAt))
  })
  /** The bag the planner works with: the capture's counts and the hand edits that still apply. */
  const bag = computed(() => {
    const g = good.value
    const edits = liveEdits.value
    return g && edits ? effectiveInventory(g.materials, edits, base.value) : null
  })
  /** The capture with the planner's bag, for the dialogs that read counts. */
  const goodView = computed<Good | null>(() =>
    good.value && bag.value ? { ...good.value, materials: bag.value } : null,
  )
  /** Edits a newer capture replaced (until the next write drops them). */
  const replaced = computed(() =>
    state.adjustments.value ? replacedAdjustments(state.adjustments.value, base.value).length : 0,
  )

  const { settings, save: saveSettings, reload: reloadSettings } = usePlannerSettings(accountId)

  const tasks = options.tasks ? usePlannerTasks(accountId) : null
  if (tasks) onBeforeUnmount(() => void tasks.flush())
  /** What irminsul read at the newest login; an AR/WL setting wins over it. */
  const player = computed(() => data.value?.player ?? NO_PLAYER)
  /**
   * Resin the live journal set since the login, null when it set none: the
   * game's own clock (`gi_tasks.resin`, Capture 1.12.0), else the count
   * (`gi_player.resin`, spent in game). It wins over the login's clock and count.
   */
  const liveResin = computed(() => {
    const inventory = data.value?.inventory
    const live = inventory?.live
    if (!live) return null
    // The game's own clock, when Capture sends it (1.12.0): exact.
    const clock = inventory.good.gi_tasks?.resin
    if (live.tasks.includes('resin') && clock) return clockReading(clock)
    const value = inventory.good.gi_player?.resin
    if (!live.player.includes('resin') || value === undefined) return null
    return liveReading(value, live.updatedAt, clock)
  })
  const ar = computed(() => settings.value.ar ?? player.value.ar)
  const wl = computed(() => settings.value.wl ?? player.value.wl)

  /** Count the Mystic ore the chunks held can be forged into (this device's choice). */
  const forge = ref(readStorage('planner:forge') === '1')
  watch(forge, (value) => writeStorage('planner:forge', value ? '1' : '0'))

  /** Characters in the snapshot, for the Mora passives (Raiden Shogun, Wanderer). */
  const ownedCharacters = computed(() => new Set((good.value?.characters ?? []).map((c) => c.key)))
  const passiveOwners = computed(() =>
    settings.value.planner.passives ? ownedCharacters.value : null,
  )
  const planOptions = computed<PlanOptions>(() => ({
    azoth: settings.value.planner.azoth,
    passives: passiveOwners.value,
    forge: forge.value,
  }))

  // One per planner data (new only when a custom character changes): each goal's cost once per state.
  const fullRequirements = computed(() =>
    planner.value ? createRequirementCache(planner.value) : null,
  )
  /** Without gemstones when the setting says so (bosses then farm only their boss materials). */
  const requirementCache = computed(() => {
    const cache = fullRequirements.value
    if (!cache || !planner.value || settings.value.planner.gems !== false) return cache
    return withoutGems(cache, planner.value)
  })
  /**
   * The goal cards. A card equal to the one before keeps its object, so only
   * the cards that changed re-render (keep-unchanged.ts).
   */
  let previousBoard: Board | null = null
  const board = computed(() => {
    const p = planner.value
    const g = good.value
    const b = bag.value
    const targets = store.targets.value
    const overrides = state.overrides.value
    const c = requirementCache.value
    if (!p || !g || !b || !targets || !overrides || !c) return null
    const next = buildBoard(p, g, b, targets, c, overrides)
    next.entries = keepUnchanged(previousBoard?.entries, next.entries)
    previousBoard = next
    return next
  })
  const totals = computed(() =>
    planner.value && bag.value && board.value
      ? planTotals(planner.value, board.value.goals, bag.value, planOptions.value)
      : null,
  )

  /** Sets a material's count (back to no edit when it is the capture's). */
  function setCount(key: string, value: number) {
    const capture = good.value?.materials[key] ?? 0
    state.change({ inventory: [countChange(key, value, capture)] })
  }

  /** Adds what was obtained to a material's count. */
  function addCount(key: string, count: number) {
    if (count !== 0) state.change({ inventory: [{ key, add: count }] })
  }

  // ------------------------------------------------------------- live

  let stale = false
  function catchUp() {
    if (!stale || updatesHeld.value || document.visibilityState !== 'visible') return
    stale = false
    void store.refresh()
    void state.refresh()
    void tasks?.refresh()
    void reloadSettings()
  }
  const stopListening = onPlannerChange((id) => {
    if (id !== accountId.value) return
    stale = true
    catchUp()
  })
  watch(updatesHeld, catchUp)
  document.addEventListener('visibilitychange', catchUp)
  onBeforeUnmount(() => {
    stopListening()
    document.removeEventListener('visibilitychange', catchUp)
  })

  return {
    accountId,
    base,
    resource,
    data,
    planner,
    basePlanner,
    good,
    drops,
    farming,
    hasCapture,
    capturedTasks,
    store,
    state,
    bag,
    goodView,
    replaced,
    settings,
    saveSettings,
    tasks,
    player,
    liveResin,
    ar,
    wl,
    forge,
    passiveOwners,
    planOptions,
    requirementCache,
    board,
    totals,
    setCount,
    addCount,
  }
}
