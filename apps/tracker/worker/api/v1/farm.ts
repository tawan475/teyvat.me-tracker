/**
 * `GET /api/v1/accounts/{id}/planner/farm` (docs/plans/public-api.md §6):
 * the one Planner answer computed here. Every active goal together, costed
 * by `@gdt/game-data`'s own Planner math against the newest capture's bag
 * (with the hand edits made on it), then the farm estimates and what today's
 * open domains can farm on the account's server. The Farm view also applies
 * the goals' priority order, its filters and the gem switch; the API gives
 * the plan for all goals at once.
 */

import {
  findCharacterState,
  findWeaponState,
  itemGoal,
  characterRequirement,
  weaponRequirement,
  planTotals,
  type MaterialLine,
  type OwnedCharacter,
  type OwnedWeapon,
  type PlanGoal,
} from '@gdt/game-data/planner-math'
import {
  farmPlan,
  todayPlan,
  type FarmGroup,
  type FarmPlan,
  type TodayPlan,
} from '@gdt/game-data/planner-estimate'
import { loadPlanner } from '@gdt/game-data'
import { loadDropRates } from '@gdt/game-data/drops'
import type {
  AccountResponse,
  AccountSettingsResponse,
  CurrentOverride,
  PlannerStateResponse,
  PlannerTargetsResponse,
} from '@gdt/shared'
import { inner, type V1Context } from './core'

interface GoodLike {
  characters?: OwnedCharacter[]
  weapons?: OwnedWeapon[]
  materials?: Record<string, number>
  gi_player?: { ar?: number; wl?: number }
}

export async function farmPlanFor(c: V1Context, accountId: number, now = Date.now()) {
  const [account, good, targets, state, settings, planner, drops] = await Promise.all([
    inner<AccountResponse>(c, 'GET', `/accounts/${accountId}`),
    inner<GoodLike>(c, 'GET', `/accounts/${accountId}/latest/good`, { conditional: false }).catch(
      () => ({ data: {} as GoodLike }),
    ),
    inner<PlannerTargetsResponse>(c, 'GET', `/accounts/${accountId}/planner-targets`),
    inner<PlannerStateResponse>(c, 'GET', `/accounts/${accountId}/planner-state`),
    inner<AccountSettingsResponse>(c, 'GET', `/accounts/${accountId}/settings`),
    loadPlanner(),
    loadDropRates(),
  ])
  const capture = good.data
  const characters = capture.characters ?? []
  const weapons = capture.weapons ?? []

  // The bag: the capture's counts with the hand edits made against it.
  const inventory: Record<string, number> = { ...(capture.materials ?? {}) }
  for (const adj of state.data.adjustments) {
    if (state.data.capturedAt !== null && adj.base < state.data.capturedAt) continue
    inventory[adj.key] = Math.max(0, (adj.set ?? inventory[adj.key] ?? 0) + adj.delta)
  }
  const overrides = new Map<string, CurrentOverride>()
  for (const o of state.data.overrides) {
    overrides.set(o.kind === 'weapon' ? `weapon:${o.id}` : `${o.kind}:${o.key}`, o)
  }

  const goals: PlanGoal[] = []
  const skipped: string[] = []
  for (const t of targets.data.targets) {
    if (t.kind === 'character') {
      const hand = overrides.get(`character:${t.key}`)
      const current =
        hand && hand.kind === 'character'
          ? hand.current
          : findCharacterState(characters, t.key).state
      const requirement = characterRequirement(planner, t.key, current, t.target)
      if (requirement)
        goals.push({ id: `character:${t.key}`, requirement, active: t.target.active })
      else skipped.push(`character:${t.key}`)
    } else if (t.kind === 'weapon') {
      if (t.target.custom) {
        skipped.push(`weapon:${t.id}`)
        continue
      }
      const hand = overrides.get(`weapon:${t.id}`)
      const current =
        hand && hand.kind === 'weapon'
          ? hand.current
          : findWeaponState(weapons, t.key, t.owner).state
      const requirement = weaponRequirement(planner, t.key, current, t.target)
      if (requirement)
        goals.push({ id: `weapon:${t.key}:${t.owner}`, requirement, active: t.target.active })
      else skipped.push(`weapon:${t.id}`)
    } else if (t.kind === 'item') {
      goals.push(itemGoal(planner, t.key, t.target))
    } else {
      skipped.push(`custom:${t.key}`)
    }
  }

  const options = settings.data.settings.planner
  const owned = new Set(characters.map((ch) => ch.key))
  const totals = planTotals(planner, goals, inventory, {
    solvent: options?.solvent ?? true,
    azoth: options?.azoth ?? false,
    passives: options?.passives === false ? null : owned,
  })
  const ar = settings.data.settings.ar ?? capture.gi_player?.ar ?? null
  const wl = settings.data.settings.wl ?? capture.gi_player?.wl ?? null
  const plan = farmPlan(planner, totals, drops, { ar, wl })
  const today = todayPlan(plan, now, account.data.server)
  const missing = [...totals.lines.values()].filter((line) => line.missing > 0).map(lineOut)
  return {
    goals: goals.filter((g) => g.active !== false).length,
    skipped,
    ar,
    wl,
    missing,
    mora: totals.mora,
    characterExp: totals.characterExp,
    weaponExp: totals.weaponExp,
    plan: planOut(plan),
    today: todayOut(today),
  }
}

// The estimates point at each other (a domain holds its groups, a group its
// domain): plain copies, ids for the links.

const lineOut = (line: MaterialLine) => ({
  key: line.material.key,
  need: line.need,
  have: line.have,
  crafted: line.crafted,
  missing: line.missing,
  goals: line.goals,
})

const groupOut = (g: FarmGroup) => ({
  id: g.id,
  kind: g.kind,
  key: g.key,
  name: g.name,
  domain: g.domain,
  weekdays: g.weekdays,
  goals: g.goals,
  need: g.need,
  missing: g.missing,
  missingByTier: g.missingByTier,
  status: g.status,
  run: g.run,
  materials: g.lines.map(lineOut),
})

function planOut(plan: FarmPlan) {
  return {
    groups: plan.groups.map(groupOut),
    domains: plan.domains.map((d) => ({
      id: d.id,
      entry: d.entry.entry,
      kind: d.entry.kind,
      name: d.entry.name,
      groups: d.groups.map((g) => g.id),
      goals: d.goals,
      status: d.status,
      run: d.run,
    })),
    weekly: plan.weekly.map((w) => ({
      id: w.id,
      boss: w.boss ? { key: w.boss.key, name: w.boss.name } : null,
      goals: w.goals,
      need: w.need,
      missing: w.missing,
      status: w.status,
      run: w.run,
      materials: w.lines.map(lineOut),
    })),
    weeklyTotal: plan.weeklyTotal,
    leyLines: plan.leyLines,
    total: plan.total,
    assumed: plan.assumed,
  }
}

function todayOut(today: TodayPlan) {
  return {
    weekday: today.weekday,
    allOpen: today.allOpen,
    msUntilReset: today.msUntilReset,
    run: today.run,
    domains: today.domains.map((d) => ({
      id: d.domain.id,
      name: d.domain.entry.name,
      groups: d.groups.map((g) => g.id),
      run: d.run,
    })),
  }
}
