/**
 * Saves of one value that change faster than the server answers (the user's
 * settings: arrow keys on the tab bar's handles send one save a press). They
 * go one at a time, in order, so the server never takes an older one last.
 * While more are waiting, an answer only becomes the `baseline` (what the
 * server holds) and the screen keeps the newest change; the last answer is
 * shown, or, when the last one fails, the baseline is put back.
 *
 * `forget()` when the value's owner changes (signed out, another user): the
 * saves still on their way settle as they would, but none of them shows or
 * restores anything, so an answer landing after sign-out never puts the
 * user it was for back on screen.
 */
export function saveQueue<S>() {
  let queue: Promise<unknown> = Promise.resolve()
  let waiting = 0
  let baseline: S | null = null
  /** Moves on `forget()`: a save counts only in the run it started in. */
  let owner = 0

  return {
    /**
     * `held`: the value on screen before this change (the baseline when
     * nothing is waiting). `show` puts an answer on screen, `restore` the
     * baseline after the last save failed. The promise settles with this
     * save's own answer or error.
     */
    async save<A>(
      held: S | null,
      send: () => Promise<A>,
      valueOf: (answer: A) => S,
      show: (answer: A) => void,
      restore: (baseline: S) => void,
    ): Promise<A> {
      const mine = owner
      if (waiting === 0) baseline = held
      waiting += 1
      const run = queue.then(send)
      queue = run.catch(() => undefined)
      try {
        const answer = await run
        if (mine !== owner) return answer
        waiting -= 1
        baseline = valueOf(answer)
        if (waiting === 0) show(answer)
        return answer
      } catch (error) {
        if (mine === owner) {
          waiting -= 1
          if (waiting === 0 && baseline !== null) restore(baseline)
        }
        throw error
      }
    },
    /** The owner changed: saves on their way touch nothing, the next one starts anew. */
    forget(): void {
      owner += 1
      waiting = 0
      baseline = null
    },
  }
}
