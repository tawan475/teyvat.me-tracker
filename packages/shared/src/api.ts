/**
 * Request schemas and response shapes for /api. The Worker validates with
 * these schemas and the browser builds requests against the same ones.
 */

import type { DeviceAlerts, PresenceResponseForAccount } from './alerts'
import { z } from 'zod'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password'
import { MAX_FAVORITE_CHARACTERS, SITE_LANGUAGES, TAB_BAR_MAX } from './settings'
import type { OAuthProvider } from './oauth'
import type {
  AccountSettings,
  DeltaChange,
  GiCapture,
  SessionUpload,
  SignupMode,
  SnapshotSummary,
  UserSettings,
} from './index'

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'At least 3 characters')
  .max(32, 'At most 32 characters')
  .regex(/^[A-Za-z0-9_.-]+$/, 'Letters, digits, dot, dash and underscore only')

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email())

/** Not trimmed or normalised here: the Worker hashes exactly what was typed (NFKC). */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters`)
  .max(MAX_PASSWORD_LENGTH, `At most ${MAX_PASSWORD_LENGTH} characters`)

/**
 * The human check's token (Cloudflare Turnstile), on the forms that ask for
 * one while the server has it on (`OAuthProvidersResponse.turnstileSiteKey`).
 */
export const turnstileToken = z.string().max(2048).optional()

export const registerRequest = z.object({
  username: usernameSchema,
  /** Optional; empty means none. Ignored while the email features are off. */
  email: emailSchema.nullish().or(z.literal('').transform(() => null)),
  password: passwordSchema,
  turnstile: turnstileToken,
})

/** Username or email. */
export const loginName = z.string().trim().toLowerCase().min(1).max(254)

/** An existing password: only bounded, since older rules may have allowed it. */
const anyPassword = z.string().min(1).max(MAX_PASSWORD_LENGTH)

export const loginRequest = z.object({
  login: loginName,
  password: anyPassword,
  turnstile: turnstileToken,
})

export const changePasswordRequest = z.object({
  currentPassword: anyPassword,
  newPassword: passwordSchema,
})

/**
 * Changes the login names. Omitted fields stay as they are; an empty or null
 * email removes it. While the email features are off, an email can only be
 * removed (another address is 403 `email_paused`).
 */
export const updateProfileRequest = z
  .object({
    username: usernameSchema.optional(),
    email: emailSchema.nullish().or(z.literal('').transform(() => null)),
  })
  .refine((body) => body.username !== undefined || body.email !== undefined, {
    message: 'Nothing to change',
  })

/** A one-time link's token: 32 random bytes, base64url (what `?token=` carries). */
export const linkToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid link')

/** `POST /api/auth/verify-email` and `/reset-password/check`. */
export const linkTokenRequest = z.object({ token: linkToken })

/** `POST /api/auth/forgot-password`: a username or email. */
export const forgotPasswordRequest = z.object({ login: loginName })

/** `POST /api/auth/reset-password`: the new password follows the sign-up rules. */
export const resetPasswordRequest = z.object({ token: linkToken, password: passwordSchema })

/** `POST /api/auth/password/set`: a first password for an account that has none. */
export const setPasswordRequest = z.object({ password: passwordSchema })

// Zod-free, for the app's startup: ./oauth.
export { OAUTH_PROVIDERS, OAUTH_PROVIDER_LABELS, type OAuthProvider } from './oauth'

/**
 * Where a sign-in may land afterwards: a path inside the app, or irminsul's
 * consent page (/link), printable ASCII only.
 */
export const appPath = z
  .string()
  // /link carries irminsul's query, its PC name percent-encoded (up to ~600).
  .max(2048)
  .regex(/^\/(?:app|link)(?:[/?#][!-~]*)?$/)

/**
 * `POST /api/auth/oauth/:provider/start`: sign in (linking from Settings is
 * `POST …/:provider/link`, no body).
 */
export const oauthStartRequest = z.object({ next: appPath.optional() })

/** `POST /api/auth/oauth/pending/register`: a new account for the pending identity. */
export const oauthRegisterRequest = z.object({
  username: usernameSchema,
  /**
   * Also set the provider's email as the account's (unconfirmed, a link is
   * mailed). Ignored while the email features are off.
   */
  useEmail: z.boolean().default(false),
  turnstile: turnstileToken,
})

export const GENSHIN_SERVERS = ['AMERICA', 'EUROPE', 'ASIA', 'SAR'] as const
export type GenshinServer = (typeof GENSHIN_SERVERS)[number]

const REGION_DIGIT: Record<string, GenshinServer> = {
  '6': 'AMERICA',
  '7': 'EUROPE',
  '8': 'ASIA',
  '9': 'SAR',
}

/**
 * The server a UID belongs to. Nine-digit UIDs lead with the region digit;
 * ten-digit ones (a region that ran out of nine) are 1 and then it, so
 * 18xxxxxxxx is Asia. China's (1, 2, 5) and anything else: null.
 */
export function serverFromUid(uid: string): GenshinServer | null {
  if (!/^\d{9,10}$/.test(uid)) return null
  const digit = uid.length === 10 ? (uid[0] === '1' ? uid[1]! : '') : uid[0]!
  return REGION_DIGIT[digit] ?? null
}

export const accountInput = z.object({
  name: z.string().trim().max(64).nullable().optional(),
  uid: z
    .string()
    .trim()
    .regex(/^\d{9,10}$/, 'A UID is 9 or 10 digits')
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  server: z.enum(GENSHIN_SERVERS).nullable().optional(),
})

export const snapshotIdsRequest = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(1000),
})

/** A GOOD key (character, weapon or material), as irminsul writes them. */
export const goodKeySchema = z.string().regex(/^[A-Za-z0-9]{1,64}$/, 'Not a GOOD key')

export const userSettingsPatch = z
  .object({
    theme: z.enum(['system', 'light', 'dark']),
    use24Hour: z.boolean(),
    language: z.enum(['system', ...SITE_LANGUAGES]),
    tabBar: z
      .array(z.string().regex(/^[a-z][a-zA-Z]{0,23}$/))
      .max(TAB_BAR_MAX)
      .refine((pages) => new Set(pages).size === pages.length, 'Each page once'),
  })
  .partial()
  .strict()

export const accountSettingsPatch = z
  .object({
    materialsGraph: z
      .object({
        selectedKeys: z.array(z.string().max(100)).max(100),
        groupBy: z.enum(['hour', 'day', 'month', 'year']),
        limit: z.number().int().min(1).max(10_000),
      })
      .partial()
      .strict(),
    traveler: z.enum(['F', 'M']),
    ar: z.number().int().min(1).max(60).nullable(),
    wl: z.number().int().min(0).max(9).nullable(),
    planner: z
      .object({
        azoth: z.boolean(),
        passives: z.boolean(),
        refreshes: z.number().int().min(0).max(6),
        /** The resin tracker's quick buttons (−40, +60): amounts to add, none zero. */
        resinSteps: z
          .array(
            z
              .number()
              .int()
              .min(-200)
              .max(200)
              .refine((n) => n !== 0, 'Not zero'),
          )
          .max(4),
        /** The resin tracker's "when resin reaches" amounts (40, 200). */
        resinMarks: z.array(z.number().int().min(1).max(200)).max(12),
        crafting: z.boolean(),
        gems: z.boolean(),
        solvent: z.boolean(),
      })
      .partial()
      .strict(),
    /**
     * Original Resin set by hand (the resin tracker): `value` at `at` (ms),
     * regenerating from then. A capture read after `at` replaces it; null:
     * none.
     */
    resin: z
      .object({
        value: z.number().int().min(0).max(2_000),
        at: z.number().int().min(0).max(8_640_000_000_000_000),
      })
      .strict()
      .nullable(),
    /** Characters pinned first on the Characters page: the whole list, each key once. */
    favoriteCharacters: z
      .array(goodKeySchema)
      .max(MAX_FAVORITE_CHARACTERS)
      .refine((keys) => new Set(keys).size === keys.length, 'Each key once'),
    /**
     * Ignored: live sync is always on, the capture app decides whether to
     * send changes. Accepted so cached builds that still send it get no 400.
     */
    liveSync: z.boolean(),
  })
  .partial()
  .strict()

// ------------------------------------------------------------ progress

const achievementIds = z.array(z.number().int().positive()).max(5000)

/**
 * Achievements marked done by hand (captured ones come from snapshots).
 * Ids are the game's achievement ids, the same as `gi_achievements`.
 */
export const achievementMarksPatch = z
  .object({ done: achievementIds.default([]), undone: achievementIds.default([]) })
  .refine((body) => body.done.length + body.undone.length > 0, { message: 'Nothing to change' })

const anecdoteIds = z.array(z.number().int().min(100_000).max(199_999)).max(2000)

/**
 * Anecdotes marked done by hand (captured ones come from snapshots). Ids are
 * the game's anecdote ids, the same as `gi_anecdotes`; a checklist marks a
 * variant's base.
 */
export const anecdoteMarksPatch = z
  .object({ done: anecdoteIds.default([]), undone: anecdoteIds.default([]) })
  .refine((body) => body.done.length + body.undone.length > 0, { message: 'Nothing to change' })

const questIds = z.array(z.number().int().min(1).max(99_999_999)).max(5000)

/**
 * Quests marked done by hand (captured ones come from snapshots): MainQuest
 * ids, as `gi_collections.quests` sends them.
 */
export const questMarksPatch = z
  .object({ done: questIds.default([]), undone: questIds.default([]) })
  .refine((body) => body.done.length + body.undone.length > 0, { message: 'Nothing to change' })

const talentLevel = z.number().int().min(1).max(10)

/** Free text on a goal (plain text, shown as is). */
const goalNote = z.string().max(1000)

/**
 * Where a goal sits in the planner's order: materials go to lower numbers
 * first (a goal is ready when the bag covers it after the ones above);
 * unset goals come last.
 */
const goalPriority = z.number().int().min(0).max(100_000)

/** Artifact slots in GOOD's order (`slotKey`). */
export const ARTIFACT_SLOT_KEYS = ['flower', 'plume', 'sands', 'goblet', 'circlet'] as const

/** A GOOD stat key ("atk_", "enerRech_", "pyro_dmg_"). */
const statKeySchema = z.string().regex(/^[A-Za-z_]{1,32}$/, 'Not a stat key')
const mainStats = z.array(statKeySchema).max(16)
/** Ticked by hand: true done, false not done (over the capture); absent: the capture says. */
const handTick = z.boolean().optional()

/**
 * Artifact goal of a character (Seelie's Artifacts tab): sets wanted (any of
 * them), main stats wanted per slot (any of them), and ticks by hand. The
 * capture ticks a slot by itself (see the planner's artifact-goals.ts).
 */
export const artifactGoal = z.object({
  sets: z.array(z.object({ key: goodKeySchema, done: handTick })).max(8),
  sands: mainStats.optional(),
  goblet: mainStats.optional(),
  circlet: mainStats.optional(),
  slots: z
    .object({
      flower: handTick,
      plume: handTick,
      sands: handTick,
      goblet: handTick,
      circlet: handTick,
    })
    .optional(),
})

/** Planner goal for a character. Levels stop at 90 until the 95/100 costs are in game-data. */

export const characterTarget = z.object({
  level: z.number().int().min(1).max(90),
  ascension: z.number().int().min(0).max(6),
  talents: z.object({ auto: talentLevel, skill: talentLevel, burst: talentLevel }),
  /** Inactive goals are kept but left out of the totals. */
  active: z.boolean().default(true),
  note: goalNote.optional(),
  favorite: z.boolean().optional(),
  priority: goalPriority.optional(),
  /**
   * Constellation set by hand (for the C3/C5 talent levels the game shows);
   * the capture's counts where it is higher.
   */
  constellation: z.number().int().min(0).max(6).optional(),
  /** Sets and main stats to farm (no material cost). */
  artifacts: artifactGoal.optional(),
  /**
   * Made by the Custom preset (goal = now) and not set yet: listed with the
   * goals to do ("Set a goal"), not as done, until a goal part is set.
   */
  unset: z.literal(true).optional(),
})

export const ELEMENT_KEYS = ['Anemo', 'Geo', 'Electro', 'Dendro', 'Hydro', 'Pyro', 'Cryo'] as const
export const WEAPON_TYPE_KEYS = ['sword', 'claymore', 'polearm', 'catalyst', 'bow'] as const

/**
 * A custom character's or weapon's picture: an https address the browser
 * shows as an image (never fetched by the server, never in a share card's
 * PNG unless that host allows it).
 */
export const customImage = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((url) => url.startsWith('https://'), { message: 'Not an https address' })

/**
 * A weapon the game data doesn't have yet: what the planner needs to cost
 * it (every weapon of a rarity levels and ascends with the same counts).
 * Materials are GOOD keys of a family's lowest tier; one not set yet is left
 * out of the cost.
 */
export const customWeapon = z.object({
  name: z.string().trim().min(1).max(40),
  rarity: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  type: z.enum(WEAPON_TYPE_KEYS),
  /** Weapon ascension material family (the domain's). */
  ascension: goodKeySchema.optional(),
  /** Elite enemy drop family. */
  elite: goodKeySchema.optional(),
  /** Common enemy drop family. */
  common: goodKeySchema.optional(),
  image: customImage.optional(),
})

/** Planner goal for a weapon (several may be the same weapon: each has its own id). */
export const weaponTarget = z.object({
  level: z.number().int().min(1).max(90),
  ascension: z.number().int().min(0).max(6),
  refinement: z.number().int().min(1).max(5),
  active: z.boolean().default(true),
  note: goalNote.optional(),
  /** A weapon goal on its own card (no character goal holds it); see `goalPriority`. */
  priority: goalPriority.optional(),
  /** A custom weapon (the goal's key is its own id, lowercase first): what it is. */
  custom: customWeapon.optional(),
})

/**
 * A weapon goal's own id, made by the client (`[a-z0-9]`, 6-32): two goals
 * can be the same weapon for the same character. Migration 0012 gave the
 * goals stored before it one.
 */
export const plannerGoalIdSchema = z.string().regex(/^[a-z0-9]{6,32}$/, 'Not a goal id')

/** A custom character's id: lowercase first, so never a GOOD key. */
export const customKeySchema = z.string().regex(/^[a-z][a-z0-9]{5,31}$/, 'Not a custom id')

/**
 * A character the game data doesn't have yet (unreleased, or newer than
 * this build): what the planner needs to cost it. Materials are GOOD keys
 * (a family by its lowest tier); one not set yet is left out of the cost.
 */
export const customCharacter = z.object({
  name: z.string().trim().min(1).max(40),
  rarity: z.union([z.literal(4), z.literal(5)]),
  element: z.enum(ELEMENT_KEYS),
  weapon: z.enum(WEAPON_TYPE_KEYS),
  /** Talent book family. */
  book: goodKeySchema.optional(),
  /** Common enemy drop family (ascension and talents). */
  common: goodKeySchema.optional(),
  /** Normal boss drop. */
  boss: goodKeySchema.optional(),
  /** Local specialty. */
  local: goodKeySchema.optional(),
  /** Weekly boss drop. */
  weekly: goodKeySchema.optional(),
  image: customImage.optional(),
  /** The goal card's background (a namecard), an https address like `image`. */
  banner: customImage.optional(),
})

/** Planner goal for a custom character: a character goal plus what it is. */
export const customTarget = characterTarget.extend({ custom: customCharacter })

/**
 * A preset file of custom characters and weapons, to copy, paste or share
 * as a file: `{"format": "teyvatme-preset", "version": 1, ...}`. A
 * character may name its signature weapon by its place in `weapons`.
 */
export const customPreset = z.object({
  format: z.literal('teyvatme-preset'),
  version: z.literal(1),
  characters: z
    .array(customCharacter.extend({ signature: z.number().int().min(0).max(49).optional() }))
    .max(50)
    .default([]),
  weapons: z.array(customWeapon).max(50).default([]),
})

/** Extra need for one material on top of every goal (Seelie's custom items). */
export const itemTarget = z.object({
  count: z.number().int().min(1).max(1_000_000_000),
  active: z.boolean().default(true),
  note: goalNote.optional(),
})

/** Character key (or custom id) a weapon goal is for, '' for a spare one. */
const weaponOwner = goodKeySchema.or(z.literal(''))

/**
 * A weapon goal by its `id`; without one (apps from before 0012), every goal
 * with that weapon and owner.
 */
const targetRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('character'), key: goodKeySchema }),
  z.object({ kind: z.literal('item'), key: goodKeySchema }),
  z.object({
    kind: z.literal('weapon'),
    key: goodKeySchema,
    owner: weaponOwner,
    id: plannerGoalIdSchema.optional(),
  }),
  z.object({ kind: z.literal('custom'), key: customKeySchema }),
])

/**
 * A goal to write. A weapon goal with an `id` is that goal (made, or its
 * weapon, owner and target changed); without one (apps from before 0012),
 * the first goal with that weapon and owner, else a new one.
 */
export const plannerTargetInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('character'), key: goodKeySchema, target: characterTarget }),
  z.object({ kind: z.literal('item'), key: goodKeySchema, target: itemTarget }),
  z.object({
    kind: z.literal('weapon'),
    key: goodKeySchema,
    owner: weaponOwner,
    id: plannerGoalIdSchema.optional(),
    target: weaponTarget,
  }),
  z.object({ kind: z.literal('custom'), key: customKeySchema, target: customTarget }),
])

/** Upserts and removals in one request (a Seelie import sends a few hundred). */
export const plannerTargetsPatch = z
  .object({
    upsert: z.array(plannerTargetInput).max(1000).default([]),
    remove: z.array(targetRef).max(1000).default([]),
  })
  .refine((body) => body.upsert.length + body.remove.length > 0, { message: 'Nothing to change' })

// ------------------------------------------------------- planner state

const MAX_COUNT = 1_000_000_000

/**
 * A hand edit of one material's count, on top of the newest capture:
 * - `set`: the count is this (`add` on top, usually 0);
 * - `set: null`: back to the capture's count (plus `add`; nothing left drops the edit);
 * - `add` alone: add to whatever the count is now (a Done takes materials away).
 */
export const inventoryChange = z
  .object({
    key: goodKeySchema,
    set: z.number().int().min(0).max(MAX_COUNT).nullable().optional(),
    add: z.number().int().min(-MAX_COUNT).max(MAX_COUNT).optional(),
  })
  .refine((c) => c.set !== undefined || c.add !== undefined, { message: 'Nothing to change' })

/** A character's level, ascension and (base) talents, set by hand. */
export const characterCurrent = z.object({
  level: z.number().int().min(1).max(90),
  ascension: z.number().int().min(0).max(6),
  talents: z.object({ auto: talentLevel, skill: talentLevel, burst: talentLevel }),
})

/** A weapon's level, ascension and refinement, set by hand. */
export const weaponCurrent = z.object({
  level: z.number().int().min(1).max(90),
  ascension: z.number().int().min(0).max(6),
  refinement: z.number().int().min(1).max(5),
})

/** A goal's current state set by hand (null: the capture's again). */
export const currentOverride = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('character'),
    key: goodKeySchema,
    current: characterCurrent.nullable(),
  }),
  z.object({
    kind: z.literal('weapon'),
    key: goodKeySchema,
    owner: weaponOwner,
    /** The goal; without one, every goal with that weapon and owner (apps from before 0012). */
    id: plannerGoalIdSchema.optional(),
    current: weaponCurrent.nullable(),
  }),
  z.object({
    kind: z.literal('custom'),
    key: customKeySchema,
    current: characterCurrent.nullable(),
  }),
])

/**
 * Hand edits on top of the newest capture, in one request (a Done sends both
 * kinds). `base` is the capture the edits were made against: its
 * `lastSeenAt`, 0 without one. When the account's newest capture is another
 * one by now, nothing is written and the answer is a 409 (`capture_changed`).
 * Every write also drops the material edits a newer capture has replaced;
 * `prune` asks for just that.
 */
export const plannerStatePatch = z
  .object({
    base: z.number().int().min(0),
    inventory: z.array(inventoryChange).max(1000).default([]),
    current: z.array(currentOverride).max(1000).default([]),
    prune: z.boolean().optional(),
  })
  .refine((body) => body.inventory.length + body.current.length > 0 || body.prune === true, {
    message: 'Nothing to change',
  })
  .refine((body) => new Set(body.inventory.map((c) => c.key)).size === body.inventory.length, {
    message: 'One change per material',
    path: ['inventory'],
  })

// ------------------------------------------------------- planner tasks

/**
 * A built-in task's id: one whose reset the planner knows (daily
 * commissions, the Spiral Abyss…; see the planner's tasks.ts). Ids are never
 * reused; an app that doesn't know one leaves it alone.
 */
export const builtinTaskIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,31}$/, 'Not a task id')

/** A game day, `YYYY-MM-DD`: the day that starts at 04:00 server time. */
export const gameDaySchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Not a day')

/**
 * How a custom task comes back: `original` keeps the rhythm of the day it
 * started on; `completed` counts from the day it was done.
 */
export const TASK_MODES = ['original', 'completed'] as const

/** A task the player made (Seelie's custom tasks): name, every N days, notes. */
export const customTask = z.object({
  name: z.string().trim().min(1).max(80),
  every: z.number().int().min(1).max(30),
  mode: z.enum(TASK_MODES),
  note: goalNote.optional(),
})

/**
 * A task's state, written whole. A built-in one rests until `next` (ms: a
 * Done moves it to the next reset, a snooze to a later day; absent or past:
 * due) and can be turned off (`hidden`). A custom one is due on the game day
 * `due` (a Done moves it on); `position` orders them.
 */
export const plannerTaskInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('builtin'),
    id: builtinTaskIdSchema,
    next: z.number().int().min(0).max(8_640_000_000_000_000).nullable().optional(),
    hidden: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('custom'),
    id: plannerGoalIdSchema,
    task: customTask,
    due: gameDaySchema,
    position: z.number().int().min(0).max(100_000).optional(),
  }),
])

const taskRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin'), id: builtinTaskIdSchema }),
  z.object({ kind: z.literal('custom'), id: plannerGoalIdSchema }),
])

/** Upserts and removals in one request (`remove` first); a Seelie import sends a few dozen. */
export const plannerTasksPatch = z
  .object({
    upsert: z.array(plannerTaskInput).max(500).default([]),
    remove: z.array(taskRef).max(500).default([]),
  })
  .refine((body) => body.upsert.length + body.remove.length > 0, { message: 'Nothing to change' })

// ------------------------------------------------------------------ responses

export interface ApiError {
  error: { code: string; message: string; issues?: { path: string; message: string }[] }
}

export interface MeResponse {
  id: number
  username: string
  email: string | null
  emailVerified: boolean
  settings: UserSettings
  /** Whether the user has an Irminsul key for all their accounts (the key itself is shown once). */
  hasImportKey: boolean
  /**
   * Whether this server can send email (confirmation and reset links). False
   * until the Worker has its `EMAIL` binding, and while `emailFeatures` is off.
   */
  emailEnabled: boolean
  /**
   * Whether the email features are on (Worker var `EMAIL_FEATURES` = "1"):
   * adding or changing an email, confirming it, "forgot password". Off, an
   * existing email still signs in and can be removed; admin reset links work.
   */
  emailFeatures: boolean
  /** False for an account made with Discord or Google: it signs in with those until it sets one. */
  hasPassword: boolean
  /**
   * Staff permission nodes from the user's roles (`*`: all of them); empty
   * for everyone else. The app hides what it can't use; the Worker checks
   * every staff request again.
   */
  permissions: string[]
}

/**
 * `GET /api/auth/oauth/providers`: the sign-in options this server has, for
 * the signed-out pages: its providers, whether the email features are on
 * (`MeResponse.emailFeatures`), the human check's site key (null while
 * it is off): sign-up, sign-in and the OAuth sign-up then send a
 * `turnstile` token; and who may sign up (the staff switch).
 */
export interface OAuthProvidersResponse {
  providers: OAuthProvider[]
  emailFeatures: boolean
  turnstileSiteKey: string | null
  signups: SignupMode
}

/** `POST /api/auth/oauth/:provider/start`: where to send the browser. */
export interface OAuthStartResponse {
  url: string
}

/**
 * `GET /api/auth/oauth/pending`: the provider account that signed in without
 * a linked user (held in a short-lived cookie, never in a URL).
 */
export interface OAuthPendingResponse {
  provider: OAuthProvider
  displayName: string | null
  email: string | null
  emailVerified: boolean
  /** A free username made from the provider's name, to start the form with. */
  username: string
  /** Where the sign-in was going (an app path), to continue there once signed in. */
  next?: string | null
}

/**
 * Why the pending identity could not be linked when signing in to link it:
 * gone (the cookie ran out), `taken` (linked to another user meanwhile) or
 * `already` (this user has another account of that provider linked).
 */
export type OAuthLinkProblem = 'expired' | 'taken' | 'already'

/** `POST /api/auth/oauth/pending/login`: signed in, and linked unless `problem`. */
export interface OAuthLinkLoginResponse {
  me: MeResponse
  linked: OAuthProvider | null
  problem: OAuthLinkProblem | null
}

export interface IdentityResponse {
  provider: OAuthProvider
  displayName: string | null
  email: string | null
  emailVerified: boolean
  avatarUrl: string | null
  createdAt: number
  /** Last sign-in with it; null: linked from Settings, never used yet. */
  lastUsedAt: number | null
}

/** `GET /api/auth/identities`: enabled providers and the user's linked accounts. */
export interface IdentitiesResponse {
  providers: OAuthProvider[]
  identities: IdentityResponse[]
}

/**
 * How a session signed in: a password, Discord or Google, a reset link,
 * `legacy` (signed in before sessions were listed; how is not known), or
 * `irminsul` (the desktop app, signed in through /link; Bearer tokens, no
 * cookies).
 */
export const SESSION_METHODS = [
  'password',
  'discord',
  'google',
  'reset',
  'legacy',
  'irminsul',
] as const
export type SessionMethod = (typeof SESSION_METHODS)[number]

/**
 * A signed-in device, as `GET /api/auth/sessions` lists them (newest
 * activity first). `ip`, `country` (ISO 3166 alpha-2) and `city` are where it
 * was last seen; the place is unknown (null) off Cloudflare.
 */
export interface SessionResponse {
  id: number
  /** This device: the session the request came with. */
  current: boolean
  method: SessionMethod
  userAgent: string | null
  ip: string | null
  country: string | null
  city: string | null
  createdAt: number
  lastSeenAt: number
  /** An irminsul session's PC name (null for a browser). */
  deviceName?: string | null
  /** Where an irminsul session's uploads go (null for a browser). */
  upload?: SessionUpload | null
  /** What the device is alerted about (null: never set; docs/plans/capture-link.md). */
  alerts?: DeviceAlerts | null
  /** A browser with a push subscription (it can get alerts). */
  push?: boolean
}

/**
 * `?oauth_error=` codes a provider round trip comes back with (to /login, or
 * to Settings when linking): `unavailable` (provider off), `state` (no or a
 * wrong state: started in another browser, or reloaded), `expired` (over 10
 * minutes), `denied` (cancelled at the provider), `failed` (the provider's
 * answer was refused), `session` (signed out or another user while linking),
 * `taken` (linked to another user), `already` (another account of that
 * provider is linked here), `rate_limited`, `suspended` (the user it signs in
 * to is suspended).
 */
export const OAUTH_ERROR_CODES = [
  'unavailable',
  'state',
  'expired',
  'denied',
  'failed',
  'session',
  'taken',
  'already',
  'rate_limited',
  'suspended',
] as const
export type OAuthErrorCode = (typeof OAUTH_ERROR_CODES)[number]

/** `POST /api/auth/verify-email`: the address now confirmed. */
export interface VerifyEmailResponse {
  email: string
}

/** `POST /api/auth/reset-password/check`: whose password the link resets. */
export interface ResetLinkResponse {
  username: string
}

/**
 * Why a one-time link was refused (the `error.code`): never issued or
 * malformed, past its time, or already used (or replaced by a newer reset).
 * A confirmation link also fails with `email_changed` once the account's
 * email is another address.
 */
export const LINK_ERROR_CODES = ['token_invalid', 'token_expired', 'token_used'] as const

export interface AccountResponse {
  id: number
  name: string | null
  uid: string | null
  server: GenshinServer | null
  createdAt: number
  dataVersion: number
  snapshotCount: number
  rawBytes: number
  storedBytes: number
  latest: {
    id: number
    takenAt: number
    lastSeenAt: number
    summary: SnapshotSummary
    /** The GOOD file's `source` ("Irminsul": Teyvat.me Capture or irminsul); absent before 2026-10-28. */
    source?: string
  } | null
  /**
   * Always true now: live sync is on for every account and the capture app
   * decides whether to send changes. Kept for builds that still read it.
   */
  liveSync?: boolean
  /** What this user may do here (account sharing); absent in answers from before it = owner. */
  access?: AccountAccess
  /** The owner's username, on accounts shared with this user. */
  owner?: string
}

/** A shared account's member role (docs/plans/account-sharing.md). */
export type AccountRole = 'viewer' | 'editor'
/** The owner, or a member's role. */
export type AccountAccess = 'owner' | AccountRole

export const ACCOUNT_ROLES = ['viewer', 'editor'] as const
/** Members an account may have (pending invites included). */
export const ACCOUNT_MEMBER_LIMIT = 8

/** `POST /api/accounts/:id/members`: invite by exact username. */
export const accountInvite = z.object({
  username: z.string().trim().min(1).max(64),
  role: z.enum(ACCOUNT_ROLES),
})
/** `PATCH /api/accounts/:id/members/:userId`. */
export const accountMemberPatch = z.object({ role: z.enum(ACCOUNT_ROLES) })

/** One person who can see an account: the owner first, then members and invites. */
export interface AccountMemberResponse {
  userId: number
  username: string
  access: AccountAccess
  /** When the invite was made (the account's creation for the owner). */
  createdAt: number
  /** Null: invited, not accepted yet. */
  acceptedAt: number | null
}

/** An invite waiting for this user (`GET /api/invitations`, and in the bootstrap). */
export interface InvitationResponse {
  accountId: number
  accountName: string | null
  uid: string | null
  owner: string
  role: AccountRole
  invitedAt: number
}

export interface AccountCreatedResponse {
  account: AccountResponse
  /** Shown once; only its hash is stored. */
  importKey: string
}

export interface SnapshotResponse {
  id: number
  takenAt: number
  lastSeenAt: number
  createdAt: number
  source: string
  rawSize: number
  storedSize: number
  summary: SnapshotSummary
  /** irminsul's `gi_capture` (why it took the snapshot, its play session); live sync. */
  capture?: GiCapture
}

export interface ImportResponse {
  status: 'created' | 'unchanged'
  snapshotId: number
  takenAt: number
  rawSize: number
  storedSize: number
  /** Present only when there is something to say; the import itself went through. */
  warnings?: ImportWarning[]
  /**
   * Where an import key's upload went (`import-by-key` only). With a user key
   * that is the account with the capture's UID, `created` when this upload
   * made it.
   */
  account?: ImportedAccount
  /** The snapshot's content key, base 36 (irminsul names a journal's base by it). */
  contentKey?: string
  /**
   * Live sync is on for the account and its journal now follows this
   * snapshot: irminsul sends batches for `base` from seq 1
   * (docs/plans/live-sync.md §13). Absent: snapshots only.
   */
  live?: ImportLive
}

export interface ImportLive {
  base: string
  /** A tracker tab of the user's is open now. */
  watching: boolean
}

export interface ImportedAccount {
  id: number
  name: string | null
  uid: string | null
  created: boolean
}

/**
 * What the live socket (`GET /api/live`) sends when the user's accounts
 * change, so open pages update without a reload:
 * - `hello`: first, on every connect: each account's id, data version and
 *   names as they are now, so a tab can tell whether it missed anything while
 *   it had no socket (and only then re-read the list).
 * - `data`: an account's snapshots changed (an import, a capture seen again,
 *   a delete); `dataVersion` is the account's new version, `takenAt` the
 *   capture time for an import.
 * - `accounts`: an account was added, renamed or removed.
 * - `planner`: an account's planner goals, hand edits or settings changed
 *   (favourite characters and anecdote marks included); `tab` is the tab
 *   that sent the change (`x-gdt-tab`), which already has it.
 * - `wishes`: an account's wish history changed (an import added pulls, or
 *   it was deleted); `tab` as for `planner`.
 * Events only say that something changed; the app re-reads the account list
 * (or, for `planner`, an open Planner re-reads its goals and edits, the
 * Characters page its favourites and the Anecdotes page its marks; for
 * `wishes`, an open Wish History page re-reads the history).
 * Every event may carry `d1` / `d1l`: the D1 bookmarks (main / live database)
 * of the write it reports, which the page sends with its next reads so a
 * replica that already has that write answers them.
 */
export type LiveEvent = (
  | { type: 'hello'; accounts: LiveAccount[] }
  | { type: 'data'; accountId: number; dataVersion: number | null; takenAt?: number }
  | { type: 'accounts' }
  | { type: 'planner'; accountId: number; tab?: string }
  | { type: 'wishes'; accountId: number; tab?: string }
  | { type: 'live'; accountId: number; seq: number }
  | ({ type: 'presence'; accountId: number } & PresenceResponseForAccount)
) & { d1?: string; d1l?: string }

/** `POST /api/irminsul/changes` (live sync, docs/plans/live-sync.md §13). */
export type LiveChangesResponse =
  | { ok: true; seq: number; collapse: boolean; watching: boolean }
  | { ok: true; duplicate: true; seq: number }
  | { ok: false; live: false }

/**
 * `GET /api/accounts/:id/live`: the account's open journal. `open` is false
 * when there is none (or live sync is off); the browser also ignores one
 * whose base is not its newest snapshot.
 */
export interface LiveJournalResponse {
  open: boolean
  base?: { snapshotId: number; contentKey: string; takenAt: number }
  /** The base snapshot's `gi_capture.session` ('' when it had none). */
  session?: string
  seq?: number
  /** Unix ms of the last batch (server clock). */
  updatedAt?: number
  /** The chart figures now. */
  figures?: SnapshotSummary
  /** Every change since the base, merged (the last value of each path). */
  changes?: DeltaChange[]
  /** The base items the changes touch: [kind, guid, fingerprint] (bindItemGuids). */
  items?: ['artifacts' | 'weapons', string, number][]
  /** Bytes the journal keeps. */
  bytes?: number
}

/** `GET /api/accounts/:id/points`: chart points per UTC day, decoded. */
export interface LivePointsResponse {
  points: { at: number; figures: SnapshotSummary }[]
}

/**
 * The close code of a live socket whose session was ended (that device was
 * signed out, or every device): the page checks its session with a refresh
 * and reconnects only if that works.
 */
export const LIVE_SESSION_ENDED_CLOSE = 4003

/** An account as the live `hello` describes it. */
export interface LiveAccount {
  id: number
  dataVersion: number
  name: string | null
  uid: string | null
  server: GenshinServer | null
}

/**
 * `uid_mismatch`: the file's `gi_player.uid` is not the account's UID (the
 * capture may be another account's). Stored anyway, as asked.
 */
export interface ImportWarning {
  /** `uid_changed`: an upload to a picked account gave it the capture's UID. */
  code: 'uid_mismatch' | 'uid_changed'
  message: string
}

/**
 * An account key names its account. A user key (`scope: "user"`) uploads to
 * every account of the user, so it names none: `accountId`, `uid` and
 * `server` are null and `dashboardUrl` is the account list.
 */
export interface VerifyKeyResponse {
  accountId: number | null
  accountName: string | null
  uid: string | null
  server: GenshinServer | null
  /** This account's page in the web app; irminsul's "Open dashboard" button opens it. */
  dashboardUrl: string
  scope: ImportKeyScope
}

export type ImportKeyScope = 'account' | 'user'

/** A new import key; shown once, only its hash is stored. */
export interface ImportKeyResponse {
  importKey: string
}

export interface AccountSettingsResponse {
  settings: AccountSettings
}

/**
 * GET /api/bootstrap: what the app needs before its first page, in one
 * request (one D1 round trip). `account` is the settings of the account
 * `?account=` named (the page being opened), null when it isn't the user's.
 */
export interface BootstrapResponse {
  me: MeResponse
  accounts: AccountResponse[]
  /** The ETag GET /api/accounts gives the same list (the app revalidates with it). */
  accountsEtag: string
  account: ({ id: number } & AccountSettingsResponse) | null
  /** Invites waiting for this user (account sharing). */
  invitations?: InvitationResponse[]
  /**
   * The user's most recently seen signed-in capture app (Teyvat.me Capture or
   * irminsul): the top bar's Capture button. Null: none signed in.
   */
  capture?: { device: string | null; lastSeenAt: number } | null
}

export interface AchievementMarksResponse {
  /** Achievement ids marked done by hand, ascending. */
  done: number[]
}

export interface AnecdoteMarksResponse {
  /** Anecdote ids marked done by hand, ascending. */
  done: number[]
}

export interface QuestMarksResponse {
  /** MainQuest ids marked done by hand, ascending. */
  done: number[]
}

export type CharacterTarget = z.infer<typeof characterTarget>
export type WeaponTarget = z.infer<typeof weaponTarget>
export type ItemTarget = z.infer<typeof itemTarget>
export type CustomCharacter = z.infer<typeof customCharacter>
export type CustomWeapon = z.infer<typeof customWeapon>
export type CustomPreset = z.infer<typeof customPreset>
export type CustomTarget = z.infer<typeof customTarget>
export type ArtifactGoal = z.infer<typeof artifactGoal>
export type ArtifactSlotKey = (typeof ARTIFACT_SLOT_KEYS)[number]

/** Weapon goals carry their own `id`; the others are one per kind and key. */
export type PlannerTarget =
  | { kind: 'character'; key: string; owner: ''; target: CharacterTarget; updatedAt: number }
  | {
      kind: 'weapon'
      id: string
      key: string
      owner: string
      target: WeaponTarget
      updatedAt: number
    }
  | { kind: 'item'; key: string; owner: ''; target: ItemTarget; updatedAt: number }
  | { kind: 'custom'; key: string; owner: ''; target: CustomTarget; updatedAt: number }

export interface PlannerTargetsResponse {
  targets: PlannerTarget[]
}

export type InventoryChange = z.input<typeof inventoryChange>
export type CharacterCurrent = z.infer<typeof characterCurrent>
export type WeaponCurrent = z.infer<typeof weaponCurrent>

/**
 * One material's hand edit: the count is `set ?? the capture's count`, plus
 * `delta`. It applies while the account's newest capture is the one it was
 * made against (`base`, that capture's `lastSeenAt`, 0 for none) or older;
 * a newer capture replaces it (irminsul is the truth).
 */
export interface InventoryAdjustment {
  key: string
  delta: number
  set: number | null
  base: number
  updatedAt: number
}

/** A goal's current state set by hand; it counts until a capture reaches it. */
export type CurrentOverride =
  | { kind: 'character'; key: string; owner: ''; current: CharacterCurrent }
  | { kind: 'weapon'; id: string; key: string; owner: string; current: WeaponCurrent }
  | { kind: 'custom'; key: string; owner: ''; current: CharacterCurrent }

export interface PlannerStateResponse {
  /** The newest capture's `lastSeenAt` (null without one): what `base` must be to write. */
  capturedAt: number | null
  adjustments: InventoryAdjustment[]
  overrides: CurrentOverride[]
}

export type CustomTask = z.infer<typeof customTask>
export type TaskMode = (typeof TASK_MODES)[number]
export type PlannerTaskInput = z.input<typeof plannerTaskInput>

/** A stored task (see `plannerTaskInput`). */
export type PlannerTask =
  | {
      kind: 'builtin'
      id: string
      next?: number | null
      hidden?: boolean
      updatedAt: number
    }
  | {
      kind: 'custom'
      id: string
      task: CustomTask
      due: string
      position?: number
      updatedAt: number
    }

export interface PlannerTasksResponse {
  /** Built-in ones first, custom ones by position (then as made). */
  tasks: PlannerTask[]
}

// ------------------------------------------------------------- wish history

/** Records per `POST /api/wishes/import` (irminsul chunks above it). */
export const WISH_IMPORT_MAX_RECORDS = 2_000
/** Records per website import request (`POST /api/accounts/:id/wishes/import`). */
export const WISH_SITE_IMPORT_MAX_RECORDS = 20_000

const wishText = (max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v))
    .pipe(z.string().max(max))

/** One record as the game's history API lists it (extra fields are ignored). */
export const wishRecordSchema = z.object({
  id: wishText(24).optional(),
  uid: wishText(12).optional(),
  gacha_type: wishText(8),
  time: wishText(32),
  name: z.string().max(80),
  item_type: wishText(32).optional(),
  rank_type: wishText(4).optional(),
  item_id: wishText(16).optional(),
})

const wishImportFields = {
  /** Hours from UTC of the records' times; the account's (by UID) when left out. */
  timezone: z.number().int().min(-12).max(14).optional(),
  region: z.string().max(32).optional(),
  lang: z.string().max(16).optional(),
}

/** `POST /api/wishes/import` (irminsul, import key or token). */
export const wishImportRequest = z.object({
  uid: z.string().regex(/^\d{9,10}$/, 'A UID is 9 or 10 digits'),
  ...wishImportFields,
  records: z.array(wishRecordSchema).max(WISH_IMPORT_MAX_RECORDS),
})

/** `POST /api/accounts/:id/wishes/import` (the website: a converted file). */
export const wishSiteImportRequest = z.object({
  /** The file's UID: records of another are skipped. */
  uid: z
    .string()
    .regex(/^\d{9,10}$/)
    .optional(),
  ...wishImportFields,
  records: z.array(wishRecordSchema).max(WISH_SITE_IMPORT_MAX_RECORDS),
})

/** Highest game id held per UIGF banner type ("301" includes 400), as decimal text. */
export type WishNewest = Record<'100' | '200' | '301' | '302' | '500', string | null>

/** `GET /api/wishes/cursor?uid=`. */
export interface WishCursorResponse {
  uid: string
  /** null: no account has this UID yet (a user key makes one on import). */
  accountId: number | null
  newest: WishNewest
  /**
   * Per banner the newest stored pull's time, "YYYY-MM-DD HH:MM:SS" on the
   * account's server clock (as the game's records write times), counting
   * pulls without game ids (from a paimon.moe / UIGF backup) too; null when
   * none. irminsul stops paging at the first record older than it.
   */
  newestTime: WishNewest
}

export interface WishImportResponse {
  accountId: number
  /** Records that were new. */
  added: number
  /** Records already held. */
  known: number
  /** Records left out (another UID's, or a banner type this server does not know). */
  skipped?: number
  /** Pulls without game ids (paimon.moe imports) that these records replaced. */
  replaced?: number
  newest: WishNewest
}

/** `GET /api/accounts/:id/wishes`: the stored chunks, decoded in the browser. */
export interface WishHistoryResponse {
  /** Hours from UTC of the stored times (null: no history yet). */
  timezone: number | null
  /** Moves on every change (the ETag). */
  version: number
  chunks: { banner: 100 | 200 | 301 | 302 | 500; data: string }[]
  /** Bytes stored. */
  bytes: number
  /** When new pulls were last stored (Unix ms; null: no history yet). */
  updatedAt?: number | null
}
