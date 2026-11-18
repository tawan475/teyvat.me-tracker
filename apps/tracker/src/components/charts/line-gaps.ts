/**
 * A line with breaks (TimelineChart): a point without a value is a capture
 * that did not share the figure (Capture's gi_off, issue 12). Pure.
 */

/**
 * Points with a value whose neighbours on both sides have none (or are the
 * line's ends): no segment reaches them, so the chart draws them as a dot.
 */
export function lonePoints(points: readonly { y: number | null }[]): Set<number> {
  const alone = new Set<number>()
  points.forEach((point, i) => {
    if (point.y === null) return
    const before = points[i - 1]
    const after = points[i + 1]
    if ((!before || before.y === null) && (!after || after.y === null)) alone.add(i)
  })
  return alone
}
