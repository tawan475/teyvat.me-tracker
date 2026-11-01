/**
 * The game's crafting slider, pure: how far it goes for each tier of a
 * family when the plan's crafts are made from the bottom up, as the game
 * leads (each craft is 3 of the tier below and `craftMora` Mora). The item
 * popover shows it beside the count to craft ("Craft 129 / 151"), so the
 * player sets the slider to exactly that, no more and no less.
 */

/**
 * For each tier (index 0 = the lowest), the slider's maximum when its turn
 * comes, or null where nothing is crafted into it: what the tier below holds
 * then (`have` plus what was crafted into it) / 3, capped by the Mora left
 * after the tiers below were crafted.
 */
export function sliderMax(
  have: readonly number[],
  crafted: readonly number[],
  craftMora: readonly number[],
  mora: number,
): (number | null)[] {
  let moraLeft = Math.max(0, mora)
  return have.map((_, i) => {
    if (i === 0 || !(crafted[i]! > 0)) return null
    const cost = craftMora[i - 1] ?? 0
    const below = (have[i - 1] ?? 0) + (crafted[i - 1] ?? 0)
    const byItems = Math.floor(Math.max(0, below) / 3)
    const max = cost > 0 ? Math.min(byItems, Math.floor(moraLeft / cost)) : byItems
    moraLeft = Math.max(0, moraLeft - crafted[i]! * cost)
    return max
  })
}
