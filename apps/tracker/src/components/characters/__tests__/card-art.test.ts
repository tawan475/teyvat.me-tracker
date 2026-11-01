import { describe, expect, it } from 'vitest'
import { ART_MOVE_MAX, ART_SCALE_MAX, ART_SCALE_MIN, clampPlace, placeRect } from '../card-art-place'

const box = { left: -712.5, top: -10, width: 2200, height: 1100 }
const whole = { x: box.left, y: box.top, width: box.width, height: box.height }

describe('card art place', () => {
  it('leaves the art where the game puts it until moved', () => {
    expect(placeRect(whole, box, { x: 0, y: 0, scale: 1 })).toEqual(whole)
  })

  it("sizes around the box's middle, then moves (as CSS translate + scale about the centre)", () => {
    const r = placeRect(whole, box, { x: 40, y: -20, scale: 1.5 })
    expect(r.width).toBe(3300)
    expect(r.height).toBe(1650)
    // The middle stays the middle, moved.
    expect(r.x + r.width / 2).toBeCloseTo(box.left + 1100 + 40)
    expect(r.y + r.height / 2).toBeCloseTo(box.top + 550 - 20)
    // A rectangle inside the box keeps its place relative to the box.
    const inner = placeRect({ x: box.left + 1100, y: box.top + 550, width: 100, height: 50 }, box, {
      x: 0,
      y: 0,
      scale: 2,
    })
    expect(inner).toEqual({ x: box.left + 1100, y: box.top + 550, width: 200, height: 100 })
  })

  it('keeps moves and sizes in range, rounded', () => {
    expect(clampPlace({ x: 99999, y: -99999, scale: 9 })).toEqual({
      x: ART_MOVE_MAX,
      y: -ART_MOVE_MAX,
      scale: ART_SCALE_MAX,
    })
    expect(clampPlace({ x: 10.4, y: -0.6, scale: 0.1 })).toEqual({
      x: 10,
      y: -1,
      scale: ART_SCALE_MIN,
    })
    expect(clampPlace({ x: 0, y: 0, scale: 1.0500000001 }).scale).toBe(1.05)
  })
})
