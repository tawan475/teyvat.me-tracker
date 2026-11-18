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

  it('shows and restores nothing for saves the owner left behind', async () => {
    const queue = saveQueue<string>()
    const shown: string[] = []
    const restored: string[] = []
    const answers = [deferred<string>(), deferred<string>()]
    const save = (held: string, answer: Promise<string>) =>
      queue.save(
        held,
        () => answer,
        (a) => a,
        (a) => shown.push(a),
        (b) => restored.push(b),
      )
    // Two saves on their way when the user signs out: one answers, one fails.
    const first = save('old', answers[0]!.promise)
    const second = save('one', answers[1]!.promise)
    queue.forget()
    answers[0]!.resolve('one')
    await expect(first).resolves.toBe('one')
    answers[1]!.reject(new Error('signed out'))
    await expect(second).rejects.toThrow('signed out')
    expect(shown).toEqual([])
    expect(restored).toEqual([])

    // The next owner's saves start anew: their own baseline, their own answers.
    const third = save('theirs', Promise.reject(new Error('offline')))
    await expect(third).rejects.toThrow('offline')
    expect(restored).toEqual(['theirs'])
    await expect(save('theirs', Promise.resolve('new'))).resolves.toBe('new')
    expect(shown).toEqual(['new'])
  })

  it("keeps an earlier owner's late answer out of the next owner's saves", async () => {
    const queue = saveQueue<string>()
    const shown: string[] = []
    const restored: string[] = []
    const late = deferred<string>()
    const save = (held: string, send: () => Promise<string>) =>
      queue.save(
        held,
        send,
        (a) => a,
        (a) => shown.push(a),
        (b) => restored.push(b),
      )
    const before = save('old', () => late.promise)
    queue.forget()
    // Queued behind the earlier save, which is still on its way.
    const after = save('theirs', () => Promise.reject(new Error('offline')))
    late.resolve('earlier user')
    await expect(before).resolves.toBe('earlier user')
    await expect(after).rejects.toThrow('offline')
    expect(shown).toEqual([])
    // Not the earlier user's answer: what the next owner had before their change.
    expect(restored).toEqual(['theirs'])
  })
})
