/**
 * Synchronous raw DEFLATE (fflate) for the v2 storage formats. Unlike the
 * platform's CompressionStream, it takes a preset dictionary, which is what
 * lets a small section be compressed against the bytes of its base. The same
 * code runs in the Worker and the browser.
 */

import { deflateSync, inflateSync } from 'fflate'
import { CorruptDataError } from './bytes'

/**
 * Level 6, not 9: on the Worker these loops run in a cold isolate (little
 * traffic per colo, so V8 rarely tiers them up), and fflate's level 9 took
 * 5–20× the CPU of level 6 on real sections for under 1% smaller output
 * (measured 2026-11-04: an upload spent ~1.2 s of CPU, mostly here). The
 * output is still raw DEFLATE: nothing stored changes shape, only its bytes.
 */
export const DEFLATE_LEVEL = 6
export function deflate(data: Uint8Array, dictionary?: Uint8Array): Uint8Array {
  return deflateSync(
    data,
    dictionary ? { level: DEFLATE_LEVEL, mem: 12, dictionary } : { level: DEFLATE_LEVEL, mem: 12 },
  )
}

export function inflate(data: Uint8Array, dictionary?: Uint8Array): Uint8Array {
  try {
    return inflateSync(data, dictionary ? { dictionary } : {})
  } catch (error) {
    throw new CorruptDataError(`Invalid deflate data: ${(error as Error).message}`)
  }
}
