// Types of public-game-data.mjs (plain JavaScript: the Dockerfile and the
// workflows run it as it is), for the tracker's tests.

export declare const PUBLIC_REPO: string
export declare const PUBLIC_URL: string
export declare function pinnedTag(spec: string | null | undefined): string | null
export declare function privateSpec(tag: string): string
export declare function publicSpec(tag: string): string
export declare function lsRemoteArgs(tag: string): string[]
export declare function hasTag(lsRemote: string, tag: string): boolean
export interface SmokeGate {
  /** Start the self-host smoke test. */
  run: boolean
  /** The tag apps/tracker pins (null: none). */
  tag: string | null
  /** Why, for the workflow's log. */
  reason: string
}
export declare function smokeGate(input: {
  variable: string | null | undefined
  spec: string | null | undefined
  lsRemote: string | null
}): SmokeGate
