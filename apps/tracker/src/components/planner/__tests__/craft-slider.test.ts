import { describe, expect, it } from 'vitest'
import { sliderMax } from '../craft-slider'

describe("the game's crafting slider", () => {
  it('goes as far as the tier below allows, once the tiers below are crafted', () => {
    // A boss family seen in game: 454 cores, 61 nuclei, 79 nexuses; the plan crafts
    // 129 nuclei (slider 151: 454 / 3), then 2 nexuses from the 190 nuclei held by then.
    expect(sliderMax([454, 61, 79], [0, 129, 2], [25, 25], 40_000_000)).toEqual([null, 151, 63])
  })

  it('is capped by the Mora left after the crafts below', () => {
    // 100 Mora at 25 a craft: the middle slider stops at 4 (not 10); after the plan's
    // 2 crafts there, 50 Mora is left for the top, which only 2 nuclei feed at all.
    expect(sliderMax([30, 0, 0], [0, 2, 1], [25, 25], 100)).toEqual([null, 4, 0])
    expect(sliderMax([30, 9, 0], [0, 2, 1], [25, 25], 100)).toEqual([null, 4, 2])
  })

  it('stops at 0, never below, when the Mora runs out', () => {
    // No Mora: the game lets nothing be crafted, at any tier.
    expect(sliderMax([900, 0, 0], [0, 288, 64], [1, 5], 0)).toEqual([null, 0, 0])
    // Mora for less than the plan's crafts below: the tiers above get none left.
    expect(sliderMax([900, 0, 0], [0, 288, 64], [1, 5], 100)).toEqual([null, 100, 0])
  })

  it('has no slider where nothing is crafted, and none for the lowest tier', () => {
    expect(sliderMax([10, 5, 0], [0, 0, 0], [5, 10], 1000)).toEqual([null, null, null])
    expect(sliderMax([10], [3], [], 1000)).toEqual([null])
  })

  it('needs no Mora where the recipe costs none', () => {
    expect(sliderMax([9, 0], [0, 3], [0], 0)).toEqual([null, 3])
  })
})
