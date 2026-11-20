import { describe, expect, it } from 'vitest'
import { inOneWindow } from './client'

describe('inOneWindow', () => {
  it('runs a burst again when a window ended during it', async () => {
    const period = 400
    let runs = 0
    const answer = await inOneWindow(async () => {
      runs++
      // The first run lasts past the end of its window; the second takes no time.
      if (runs === 1) {
        const left = period - (Date.now() % period)
        await new Promise((done) => setTimeout(done, left + 20))
      }
      return runs
    }, period)
    expect(answer).toBe(2)
  })

  it('keeps the answer of a burst inside one window', async () => {
    let runs = 0
    expect(await inOneWindow(async () => ++runs)).toBe(1)
    expect(runs).toBe(1)
  })
})
