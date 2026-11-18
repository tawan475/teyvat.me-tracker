import { describe, expect, it } from 'vitest'
import { saveQueue } from '../save-queue'

/** A save the test answers by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('saveQueue', () => {
  it('sends one save at a time and shows only the last answer', async () => {
    const queue = saveQueue<string[]>()
    const sent: string[][] = []
    const shown: string[][] = []
    const restored: string[][] = []
    const answers = [deferred<string[]>(), deferred<string[]>(), deferred<string[]>()]
    const lists = [
      ['b', 'a'],
      ['b', 'c', 'a'],
      ['c', 'b', 'a'],
    ]
    const saves = lists.map((list, i) =>
      queue.save(
        i === 0 ? ['a', 'b'] : lists[i - 1]!,
        () => {
          sent.push(list)
          return answers[i]!.promise
        },
        (answer) => answer,
        (answer) => shown.push(answer),
        (baseline) => restored.push(baseline),
      ),
    )
    await flush()
    expect(sent).toEqual([lists[0]])
    answers[0]!.resolve(lists[0]!)
    await flush()
    expect(sent).toEqual([lists[0], lists[1]])
    expect(shown).toEqual([])
    answers[1]!.resolve(lists[1]!)
    await flush()
    answers[2]!.resolve(lists[2]!)
    await Promise.all(saves)
    expect(sent).toEqual(lists)
    expect(shown).toEqual([lists[2]])
    expect(restored).toEqual([])
  })

  it('keeps sending after a failed save and shows the last answer', async () => {
    const queue = saveQueue<string>()
    const shown: string[] = []
    const restored: string[] = []
    const first = queue.save(
      'old',
      () => Promise.reject(new Error('offline')),
      (a) => a,
      (a) => shown.push(a),
      (b) => restored.push(b),
    )
    const second = queue.save(
      'one',
      () => Promise.resolve('two'),
      (a) => a,
      (a) => shown.push(a),
      (b) => restored.push(b),
    )
    await expect(first).rejects.toThrow('offline')
    await expect(second).resolves.toBe('two')
    expect(shown).toEqual(['two'])
    expect(restored).toEqual([])
  })

  it('puts back what the server holds when the last save fails', async () => {
    const queue = saveQueue<string>()
    const shown: string[] = []
    const restored: string[] = []
    const first = queue.save(
      'old',
      () => Promise.resolve('one'),
      (a) => a,
      (a) => shown.push(a),
      (b) => restored.push(b),
    )
    const second = queue.save(
      'one',
      () => Promise.reject(new Error('offline')),
      (a) => a,
      (a) => shown.push(a),
      (b) => restored.push(b),
    )
    await expect(first).resolves.toBe('one')
    await expect(second).rejects.toThrow('offline')
    expect(shown).toEqual([])
    expect(restored).toEqual(['one'])
  })

  it('puts back the value from before the burst when every save fails', async () => {
    const queue = saveQueue<string>()
    const restored: string[] = []
    const fail = () => Promise.reject(new Error('offline'))
    const a = queue.save(
      'old',
      fail,
      (x) => x,
      () => undefined,
      (b) => restored.push(b),
    )
    const b = queue.save(
      'one',
      fail,
      (x) => x,
      () => undefined,
      (b) => restored.push(b),
    )
    await expect(a).rejects.toThrow()
    await expect(b).rejects.toThrow()
    expect(restored).toEqual(['old'])
  })
})
