# Teyvat.me API (v1)

> The public API of Teyvat.me (https://teyvat.me), a Genshin Impact account tracker: read and change your accounts, snapshots (GOOD files), wish history, marks, the Planner and sharing with a personal token. Unofficial fan project, not affiliated with HoYoverse. Human docs: https://teyvat.me/developers/api · OpenAPI: https://teyvat.me/api/v1/openapi.json

## Getting started

The Teyvat.me API reads and changes what you keep on Teyvat.me: your Genshin accounts, their snapshots (GOOD files), wish history, achievement marks, the Planner and sharing. It answers JSON under `https://teyvat.me/api/v1`.

- Make a token: Settings → API tokens → Create token. Every token reads all areas of the accounts it covers; tick what it may also change.
- Send it as `Authorization: Bearer <token>`.
- Read the limits from the answers’ headers, and poll no more often than every 5 minutes, with `If-None-Match`.

```bash
curl https://teyvat.me/api/v1/accounts \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

The whole reference is also machine-readable: `/api/v1/openapi.json` (OpenAPI 3.1) and `/developers/api.md` (one Markdown file, for AI helpers).

## Authentication

A token looks like `gdt_pat_<id>_<secret>`. It is shown once when made; only a hash of its secret is kept. It expires after 30, 90 or 365 days, or never, and can be revoked in Settings at any time. A revoked token can keep working for up to a minute.

- Areas: `accounts`, `snapshots`, `wishes`, `progress`, `planner`, `sharing`, `capture`. A token reads every area; it writes only the ones it was given. A route it can’t use answers 403 `scope_missing`.
- A token covers all your accounts, or the ones you picked (403 `account_not_in_token` for others).
- On an account shared with you, a token can do what your role allows: a viewer’s token never writes.
- A token never changes your password, email, passkeys, sign-ins or devices, never makes tokens or import keys, and never deletes your user.

Browsers: answers carry `Access-Control-Allow-Origin: *`, so a page can call the API with a token the user pastes. Never put a token in a page’s source.

## Responses

Every success is an object with `data`; lists add `meta`. Fields are camelCase and always present (`null` when unknown). Times are ISO 8601 UTC, except wish times, which are the game’s own text on the account’s server clock. Wish ids are strings. Game things use their GOOD keys.

```json
{ "data": { … } }
{ "data": [ … ], "meta": { "nextCursor": "…", "limit": 50 } }
```

- Raw first: answers are the data as stored. Only the wish summary and the farm plan are computed.
- Every answer has `X-Request-Id`; quote it in a bug report.
- `ETag` on reads: send it back as `If-None-Match` and an unchanged account answers 304 at once.

## Errors

Errors are RFC 9457 problem details (`application/problem+json`). `code` is the stable name to act on; `detail` is for people.

```json
{
  "type": "https://teyvat.me/developers/api#error-scope_missing",
  "title": "Missing scope",
  "status": 403,
  "code": "scope_missing",
  "detail": "This token can't change progress",
  "instance": "req_9Kd2mQ7xR4tA"
}
```

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request`, `invalid_json` | The body or query failed validation (`errors` lists where) |
| 401 | `token_invalid`, `token_expired`, `unauthenticated` | No usable token |
| 403 | `scope_missing`, `account_not_in_token`, `forbidden`, `account_suspended` | Not allowed |
| 404 | `not_found` | No such thing, or not yours |
| 409 | `uid_taken`, `capture_changed`, `not_playing` | The state doesn’t allow it now |
| 413 / 422 / 429 | `storage_quota`, `too_many_items`, `daily_upload_limit` | Upload limits |
| 429 | `rate_limited` | A rate limit: wait `Retry-After` seconds |

## Pagination

Lists take `limit` (1–200, default 50) and `cursor`. Pass the last page’s `meta.nextCursor` to get the next one; `null` means the last page. Cursors are opaque.

## Rate limits

Two layers, per user: a global limit on every request, and a bucket per endpoint, counted per account on routes under `/accounts/{id}`. Every token you make shares them. Per minute.

| Bucket | Endpoints | Free | Supporter |
| --- | --- | --- | --- |
| global | Every request, 304s included | 20 / min | 60 / min |
| `read` | Everything not below | global only | global only |
| `good` | GOOD of the newest or a snapshot, GOOD sections | 6 / min | 20 / min |
| `wish-summary` | Wish summary (computed) | 6 / min | 20 / min |
| `farm` | Farm plan (computed) | 6 / min | 20 / min |
| `wish-export` | UIGF export | 2 / min | 6 / min |
| `upload` | Upload a snapshot | 6 / min | 20 / min |
| `wish-import` | Wish import | 2 / min | 6 / min |
| `write` | Every other POST, PATCH, DELETE | 10 / min | 30 / min |
| `destructive` | Delete all wishes, compact history, delete an account | 2 / min | 2 / min |

- Every answer: `X-RateLimit-Bucket`, `X-RateLimit-Limit` (the bucket’s), `X-RateLimit-Global-Limit`, `X-RateLimit-Tier`.
- A 429 adds `X-RateLimit-Scope` (`user`, `global` or `ip`), `X-RateLimit-Global: true` for the global limit, and `Retry-After`; the problem body has `scope`, `global`, `bucket`, `limit` and `retryAfter`.
- Counts are approximate (counted per Cloudflare location), so no remaining count is sent. Don’t hard-code the numbers: read the headers.
- More than 60 rejected tokens (401 / 403) from one address in 10 minutes blocks it for 10 minutes. Stop using a token once it answers 401.
- Uploads also keep the daily snapshot and storage limits every account has. Game data files are never counted.

## Supporter limits

Supporters get three times every bucket (and the global limit). Nothing else changes.

- Help with server costs on Ko-fi: https://ko-fi.com/tawan475
- Message us on Discord with your Teyvat.me username: https://discord.gg/W6GUY3UtAx
- We switch your limits on.

Need more than that? Contact us on Discord to discuss: https://discord.gg/W6GUY3UtAx

## Versioning

`/api/v1` only grows: new endpoints, new fields, new enum values. Ignore what you don’t know. A breaking change makes `/api/v2`; v1 then keeps answering for at least 12 months, with `Deprecation` and `Sunset` headers and a changelog entry.

## Game data

Answers use GOOD keys and game ids. Names, icons and rarities are in public files under `/data/v1/` (no token, not counted). Start from `/data/v1/manifest.json`: it names the game data version, the languages and every file with its hash.

```bash
curl https://teyvat.me/data/v1/manifest.json
curl https://teyvat.me/data/v1/en/characters.json
```

Each entry carries its `icon` as a full URL (or `null`): game art is linked, never stored on Teyvat.me.

## Changelog

- 2026-11-14: v1.

## Endpoints

## Me

### GET /api/v1/me

Who you are. The user, your rate limits, and what this token may do.

- Scope: any token

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/me" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "id": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "username": {
   "type": "string"
  },
  "limits": {
   "type": "object",
   "properties": {
    "tier": {
     "type": "string",
     "enum": [
      "free",
      "supporter"
     ]
    },
    "global": {
     "type": "integer",
     "minimum": -9007199254740991,
     "maximum": 9007199254740991,
     "description": "Requests a minute, all routes"
    },
    "buckets": {
     "type": "object",
     "propertyNames": {
      "type": "string",
      "enum": [
       "read",
       "good",
       "wish-summary",
       "farm",
       "wish-export",
       "upload",
       "wish-import",
       "write",
       "destructive"
      ]
     },
     "additionalProperties": {
      "anyOf": [
       {
        "type": "integer",
        "minimum": -9007199254740991,
        "maximum": 9007199254740991
       },
       {
        "type": "null"
       }
      ]
     },
     "required": [
      "read",
      "good",
      "wish-summary",
      "farm",
      "wish-export",
      "upload",
      "wish-import",
      "write",
      "destructive"
     ],
     "description": "Per minute; null: only the global limit"
    }
   },
   "required": [
    "tier",
    "global",
    "buckets"
   ],
   "additionalProperties": false
  },
  "token": {
   "anyOf": [
    {
     "type": "object",
     "properties": {
      "id": {
       "type": "string"
      },
      "write": {
       "type": "array",
       "items": {
        "type": "string",
        "enum": [
         "accounts",
         "snapshots",
         "wishes",
         "progress",
         "planner",
         "sharing",
         "capture"
        ]
       },
       "description": "Areas it may change; it reads every area"
      },
      "accounts": {
       "anyOf": [
        {
         "type": "array",
         "items": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
         }
        },
        {
         "type": "null"
        }
       ],
       "description": "null: every account"
      }
     },
     "required": [
      "id",
      "write",
      "accounts"
     ],
     "additionalProperties": false
    },
    {
     "type": "null"
    }
   ],
   "description": "null when called with the website session"
  }
 },
 "required": [
  "id",
  "username",
  "limits",
  "token"
 ],
 "additionalProperties": false
}
```

Example answer:
```json
{
  "data": {
    "id": 7,
    "username": "player01",
    "limits": {
      "tier": "free",
      "global": 20,
      "buckets": {
        "read": null,
        "good": 6,
        "wish-summary": 6,
        "farm": 6,
        "wish-export": 2,
        "upload": 6,
        "wish-import": 2,
        "write": 10,
        "destructive": 2
      }
    },
    "token": {
      "id": "8Kd2mQ7xR4tA",
      "write": [
        "planner"
      ],
      "accounts": null
    }
  }
}
```

### GET /api/v1/me/usage

Storage used. What your own accounts store against your quota, split by kind.

- Scope: accounts · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/me/usage" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "Bytes stored per kind and account, the quota"
}
```

## Accounts

### GET /api/v1/accounts

List accounts. Your Genshin accounts and the ones shared with you (only those this token covers).

- Scope: accounts · Read

- Bucket: `read` (global only)

- Send `If-None-Match` for a 304 when unchanged.

Example:
```bash
curl "https://teyvat.me/api/v1/accounts" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "array",
 "items": {
  "type": "object",
  "properties": {
   "id": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "name": {
    "type": [
     "string",
     "null"
    ]
   },
   "uid": {
    "type": [
     "string",
     "null"
    ]
   },
   "server": {
    "type": [
     "string",
     "null"
    ]
   },
   "role": {
    "type": "string",
    "enum": [
     "owner",
     "editor",
     "viewer"
    ]
   },
   "owner": {
    "description": "The owner's username on accounts shared with you",
    "type": [
     "string",
     "null"
    ]
   },
   "createdAt": {
    "type": "string",
    "format": "date-time",
    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
    "description": "ISO 8601, UTC"
   },
   "version": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991,
    "description": "Moves on every change to the account’s data"
   },
   "snapshotCount": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "rawBytes": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "storedBytes": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "latest": {
    "anyOf": [
     {
      "type": "object",
      "properties": {
       "snapshotId": {
        "type": "integer",
        "minimum": -9007199254740991,
        "maximum": 9007199254740991
       },
       "takenAt": {
        "type": "string",
        "format": "date-time",
        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
        "description": "ISO 8601, UTC"
       },
       "lastSeenAt": {
        "type": "string",
        "format": "date-time",
        "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
        "description": "ISO 8601, UTC"
       },
       "source": {
        "type": [
         "string",
         "null"
        ]
       },
       "summary": {
        "type": "object",
        "propertyNames": {
         "type": "string"
        },
        "additionalProperties": {
         "type": "number"
        },
        "description": "Counts at the capture: characters, weapons, artifacts, materials, mora, primogem, artifact3, artifact4…"
       }
      },
      "required": [
       "snapshotId",
       "takenAt",
       "lastSeenAt",
       "source",
       "summary"
      ],
      "additionalProperties": false
     },
     {
      "type": "null"
     }
    ]
   }
  },
  "required": [
   "id",
   "name",
   "uid",
   "server",
   "role",
   "owner",
   "createdAt",
   "version",
   "snapshotCount",
   "rawBytes",
   "storedBytes",
   "latest"
  ],
  "additionalProperties": false
 }
}
```

Example answer:
```json
{
  "data": [
    {
      "id": 12,
      "name": "Main",
      "uid": "812345678",
      "server": "ASIA",
      "role": "owner",
      "owner": null,
      "createdAt": "2026-10-01T09:00:00.000Z",
      "version": 418,
      "snapshotCount": 151,
      "rawBytes": 92000000,
      "storedBytes": 210000,
      "latest": {
        "snapshotId": 9021,
        "takenAt": "2026-11-14T03:00:00.000Z",
        "lastSeenAt": "2026-11-14T03:00:00.000Z",
        "source": "Irminsul",
        "summary": {
          "characters": 98,
          "weapons": 412,
          "artifacts": 1611,
          "mora": 72164464
        }
      }
    }
  ]
}
```

### POST /api/v1/accounts

Create an account. A new Genshin account (its import key is not given out: upload with this token).

- Scope: accounts · Write

- Bucket: `write` (10 / min free, 30 / min supporter)

Body:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "name": {
   "anyOf": [
    {
     "type": "string",
     "maxLength": 64
    },
    {
     "type": "null"
    }
   ]
  },
  "uid": {
   "anyOf": [
    {
     "type": "string",
     "pattern": "^\\d{9,10}$"
    },
    {
     "type": "null"
    }
   ]
  },
  "server": {
   "description": "ASIA, EUROPE, AMERICA, TW_HK_MO, CN…",
   "type": [
    "string",
    "null"
   ]
  }
 }
}
```

Example:
```bash
curl -X POST "https://teyvat.me/api/v1/accounts" \
  -H "Authorization: Bearer $TEYVAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alt","uid":"712345678","server":"EUROPE"}'
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "id": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "name": {
   "type": [
    "string",
    "null"
   ]
  },
  "uid": {
   "type": [
    "string",
    "null"
   ]
  },
  "server": {
   "type": [
    "string",
    "null"
   ]
  },
  "role": {
   "type": "string",
   "enum": [
    "owner",
    "editor",
    "viewer"
   ]
  },
  "owner": {
   "description": "The owner's username on accounts shared with you",
   "type": [
    "string",
    "null"
   ]
  },
  "createdAt": {
   "type": "string",
   "format": "date-time",
   "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
   "description": "ISO 8601, UTC"
  },
  "version": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991,
   "description": "Moves on every change to the account’s data"
  },
  "snapshotCount": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "rawBytes": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "storedBytes": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "latest": {
   "anyOf": [
    {
     "type": "object",
     "properties": {
      "snapshotId": {
       "type": "integer",
       "minimum": -9007199254740991,
       "maximum": 9007199254740991
      },
      "takenAt": {
       "type": "string",
       "format": "date-time",
       "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
       "description": "ISO 8601, UTC"
      },
      "lastSeenAt": {
       "type": "string",
       "format": "date-time",
       "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
       "description": "ISO 8601, UTC"
      },
      "source": {
       "type": [
        "string",
        "null"
       ]
      },
      "summary": {
       "type": "object",
       "propertyNames": {
        "type": "string"
       },
       "additionalProperties": {
        "type": "number"
       },
       "description": "Counts at the capture: characters, weapons, artifacts, materials, mora, primogem, artifact3, artifact4…"
      }
     },
     "required": [
      "snapshotId",
      "takenAt",
      "lastSeenAt",
      "source",
      "summary"
     ],
     "additionalProperties": false
    },
    {
     "type": "null"
    }
   ]
  }
 },
 "required": [
  "id",
  "name",
  "uid",
  "server",
  "role",
  "owner",
  "createdAt",
  "version",
  "snapshotCount",
  "rawBytes",
  "storedBytes",
  "latest"
 ],
 "additionalProperties": false
}
```

Errors: `uid_taken`, `invalid_request`, `rate_limited`.

### GET /api/v1/accounts/{id}

Get an account.

- Scope: accounts · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "id": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "name": {
   "type": [
    "string",
    "null"
   ]
  },
  "uid": {
   "type": [
    "string",
    "null"
   ]
  },
  "server": {
   "type": [
    "string",
    "null"
   ]
  },
  "role": {
   "type": "string",
   "enum": [
    "owner",
    "editor",
    "viewer"
   ]
  },
  "owner": {
   "description": "The owner's username on accounts shared with you",
   "type": [
    "string",
    "null"
   ]
  },
  "createdAt": {
   "type": "string",
   "format": "date-time",
   "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
   "description": "ISO 8601, UTC"
  },
  "version": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991,
   "description": "Moves on every change to the account’s data"
  },
  "snapshotCount": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "rawBytes": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "storedBytes": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "latest": {
   "anyOf": [
    {
     "type": "object",
     "properties": {
      "snapshotId": {
       "type": "integer",
       "minimum": -9007199254740991,
       "maximum": 9007199254740991
      },
      "takenAt": {
       "type": "string",
       "format": "date-time",
       "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
       "description": "ISO 8601, UTC"
      },
      "lastSeenAt": {
       "type": "string",
       "format": "date-time",
       "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
       "description": "ISO 8601, UTC"
      },
      "source": {
       "type": [
        "string",
        "null"
       ]
      },
      "summary": {
       "type": "object",
       "propertyNames": {
        "type": "string"
       },
       "additionalProperties": {
        "type": "number"
       },
       "description": "Counts at the capture: characters, weapons, artifacts, materials, mora, primogem, artifact3, artifact4…"
      }
     },
     "required": [
      "snapshotId",
      "takenAt",
      "lastSeenAt",
      "source",
      "summary"
     ],
     "additionalProperties": false
    },
    {
     "type": "null"
    }
   ]
  }
 },
 "required": [
  "id",
  "name",
  "uid",
  "server",
  "role",
  "owner",
  "createdAt",
  "version",
  "snapshotCount",
  "rawBytes",
  "storedBytes",
  "latest"
 ],
 "additionalProperties": false
}
```

Errors: `not_found`, `rate_limited`.

### PATCH /api/v1/accounts/{id}

Rename an account. Name, UID or server; owner only.

- Scope: accounts · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Body:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "name": {
   "anyOf": [
    {
     "type": "string",
     "maxLength": 64
    },
    {
     "type": "null"
    }
   ]
  },
  "uid": {
   "anyOf": [
    {
     "type": "string",
     "pattern": "^\\d{9,10}$"
    },
    {
     "type": "null"
    }
   ]
  },
  "server": {
   "description": "ASIA, EUROPE, AMERICA, TW_HK_MO, CN…",
   "type": [
    "string",
    "null"
   ]
  }
 }
}
```

Example:
```bash
curl -X PATCH "https://teyvat.me/api/v1/accounts/12" \
  -H "Authorization: Bearer $TEYVAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Main (Asia)"}'
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "id": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "name": {
   "type": [
    "string",
    "null"
   ]
  },
  "uid": {
   "type": [
    "string",
    "null"
   ]
  },
  "server": {
   "type": [
    "string",
    "null"
   ]
  },
  "role": {
   "type": "string",
   "enum": [
    "owner",
    "editor",
    "viewer"
   ]
  },
  "owner": {
   "description": "The owner's username on accounts shared with you",
   "type": [
    "string",
    "null"
   ]
  },
  "createdAt": {
   "type": "string",
   "format": "date-time",
   "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
   "description": "ISO 8601, UTC"
  },
  "version": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991,
   "description": "Moves on every change to the account’s data"
  },
  "snapshotCount": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "rawBytes": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "storedBytes": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "latest": {
   "anyOf": [
    {
     "type": "object",
     "properties": {
      "snapshotId": {
       "type": "integer",
       "minimum": -9007199254740991,
       "maximum": 9007199254740991
      },
      "takenAt": {
       "type": "string",
       "format": "date-time",
       "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
       "description": "ISO 8601, UTC"
      },
      "lastSeenAt": {
       "type": "string",
       "format": "date-time",
       "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
       "description": "ISO 8601, UTC"
      },
      "source": {
       "type": [
        "string",
        "null"
       ]
      },
      "summary": {
       "type": "object",
       "propertyNames": {
        "type": "string"
       },
       "additionalProperties": {
        "type": "number"
       },
       "description": "Counts at the capture: characters, weapons, artifacts, materials, mora, primogem, artifact3, artifact4…"
      }
     },
     "required": [
      "snapshotId",
      "takenAt",
      "lastSeenAt",
      "source",
      "summary"
     ],
     "additionalProperties": false
    },
    {
     "type": "null"
    }
   ]
  }
 },
 "required": [
  "id",
  "name",
  "uid",
  "server",
  "role",
  "owner",
  "createdAt",
  "version",
  "snapshotCount",
  "rawBytes",
  "storedBytes",
  "latest"
 ],
 "additionalProperties": false
}
```

Errors: `not_found`, `forbidden`, `uid_taken`, `rate_limited`.

### DELETE /api/v1/accounts/{id}

Delete an account. The account and everything stored for it, at once. Owner only.

- Scope: accounts · Write

- Bucket: `destructive` (2 / min free, 2 / min supporter, per account)

Example:
```bash
curl -X DELETE "https://teyvat.me/api/v1/accounts/12" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer: 204 with no body.

Errors: `not_found`, `forbidden`, `rate_limited`.

### GET /api/v1/accounts/{id}/settings

Account settings.

- Scope: accounts · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/settings" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "The account settings (traveler, planner options…)"
}
```

### PATCH /api/v1/accounts/{id}/settings

Change account settings. A merge: fields left out stay.

- Scope: accounts · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Body:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "materialsGraph": {
   "type": "object",
   "properties": {
    "selectedKeys": {
     "maxItems": 100,
     "type": "array",
     "items": {
      "type": "string",
      "maxLength": 100
     }
    },
    "groupBy": {
     "type": "string",
     "enum": [
      "hour",
      "day",
      "month",
      "year"
     ]
    },
    "limit": {
     "type": "integer",
     "minimum": 1,
     "maximum": 10000
    }
   },
   "additionalProperties": false
  },
  "traveler": {
   "type": "string",
   "enum": [
    "F",
    "M"
   ]
  },
  "ar": {
   "anyOf": [
    {
     "type": "integer",
     "minimum": 1,
     "maximum": 60
    },
    {
     "type": "null"
    }
   ]
  },
  "wl": {
   "anyOf": [
    {
     "type": "integer",
     "minimum": 0,
     "maximum": 9
    },
    {
     "type": "null"
    }
   ]
  },
  "planner": {
   "type": "object",
   "properties": {
    "azoth": {
     "type": "boolean"
    },
    "passives": {
     "type": "boolean"
    },
    "refreshes": {
     "type": "integer",
     "minimum": 0,
     "maximum": 6
    },
    "resinSteps": {
     "maxItems": 4,
     "type": "array",
     "items": {
      "type": "integer",
      "minimum": -200,
      "maximum": 200
     }
    },
    "resinMarks": {
     "maxItems": 12,
     "type": "array",
     "items": {
      "type": "integer",
      "minimum": 1,
      "maximum": 200
     }
    },
    "crafting": {
     "type": "boolean"
    },
    "gems": {
     "type": "boolean"
    },
    "solvent": {
     "type": "boolean"
    }
   },
   "additionalProperties": false
  },
  "resin": {
   "anyOf": [
    {
     "type": "object",
     "properties": {
      "value": {
       "type": "integer",
       "minimum": 0,
       "maximum": 2000
      },
      "at": {
       "type": "integer",
       "minimum": 0,
       "maximum": 8640000000000000
      }
     },
     "required": [
      "value",
      "at"
     ],
     "additionalProperties": false
    },
    {
     "type": "null"
    }
   ]
  },
  "favoriteCharacters": {
   "maxItems": 200,
   "type": "array",
   "items": {
    "type": "string",
    "pattern": "^[A-Za-z0-9]{1,64}$"
   }
  },
  "liveSync": {
   "type": "boolean"
  }
 },
 "additionalProperties": false
}
```

Example:
```bash
curl -X PATCH "https://teyvat.me/api/v1/accounts/12/settings" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "The account settings (traveler, planner options…)"
}
```

## Snapshots

### GET /api/v1/accounts/{id}/snapshots

List snapshots. Every capture stored, newest first, with its counts.

- Scope: snapshots · Read

- Bucket: `read` (global only)

Query:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "limit": {
   "default": 50,
   "description": "1–200, default 50",
   "type": "integer",
   "minimum": 1,
   "maximum": 200
  },
  "cursor": {
   "description": "`meta.nextCursor` of the page before",
   "type": "string",
   "maxLength": 400
  }
 }
}
```

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/snapshots" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "array",
 "items": {
  "type": "object",
  "properties": {
   "id": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "takenAt": {
    "type": "string",
    "format": "date-time",
    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
    "description": "ISO 8601, UTC"
   },
   "lastSeenAt": {
    "type": "string",
    "format": "date-time",
    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
    "description": "The last time the same data was uploaded again"
   },
   "createdAt": {
    "type": "string",
    "format": "date-time",
    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
    "description": "ISO 8601, UTC"
   },
   "source": {
    "type": "string"
   },
   "rawBytes": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "storedBytes": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "summary": {
    "type": "object",
    "propertyNames": {
     "type": "string"
    },
    "additionalProperties": {
     "type": "number"
    },
    "description": "Counts at the capture: characters, weapons, artifacts, materials, mora, primogem, artifact3, artifact4…"
   },
   "capture": {
    "anyOf": [
     {
      "type": "object",
      "propertyNames": {
       "type": "string"
      },
      "additionalProperties": {}
     },
     {
      "type": "null"
     }
    ],
    "description": "Capture's `gi_capture`, when it took it"
   }
  },
  "required": [
   "id",
   "takenAt",
   "lastSeenAt",
   "createdAt",
   "source",
   "rawBytes",
   "storedBytes",
   "summary",
   "capture"
  ],
  "additionalProperties": false
 }
}
```

### GET /api/v1/accounts/{id}/snapshots/{snapshotId}

Get a snapshot.

- Scope: snapshots · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/snapshots/1" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "id": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "takenAt": {
   "type": "string",
   "format": "date-time",
   "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
   "description": "ISO 8601, UTC"
  },
  "lastSeenAt": {
   "type": "string",
   "format": "date-time",
   "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
   "description": "The last time the same data was uploaded again"
  },
  "createdAt": {
   "type": "string",
   "format": "date-time",
   "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
   "description": "ISO 8601, UTC"
  },
  "source": {
   "type": "string"
  },
  "rawBytes": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "storedBytes": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "summary": {
   "type": "object",
   "propertyNames": {
    "type": "string"
   },
   "additionalProperties": {
    "type": "number"
   },
   "description": "Counts at the capture: characters, weapons, artifacts, materials, mora, primogem, artifact3, artifact4…"
  },
  "capture": {
   "anyOf": [
    {
     "type": "object",
     "propertyNames": {
      "type": "string"
     },
     "additionalProperties": {}
    },
    {
     "type": "null"
    }
   ],
   "description": "Capture's `gi_capture`, when it took it"
  }
 },
 "required": [
  "id",
  "takenAt",
  "lastSeenAt",
  "createdAt",
  "source",
  "rawBytes",
  "storedBytes",
  "summary",
  "capture"
 ],
 "additionalProperties": false
}
```

Errors: `not_found`, `rate_limited`.

### GET /api/v1/accounts/{id}/good

Newest capture as GOOD. The newest snapshot, as stored, in GOOD format with the `gi_*` keys. The live journal on top of it is a separate read (`/live`).

- Scope: snapshots · Read

- Bucket: `good` (6 / min free, 20 / min supporter, per account)

- Send `If-None-Match` for a 304 when unchanged.

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/good" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "A GOOD file (version 3) with the `gi_*` keys"
}
```

Example answer:
```json
{
  "data": {
    "format": "GOOD",
    "version": 3,
    "source": "Teyvat.me",
    "characters": [
      {
        "key": "Furina",
        "level": 90,
        "constellation": 2,
        "ascension": 6,
        "talent": {
          "auto": 1,
          "skill": 10,
          "burst": 10
        }
      }
    ],
    "gi_player": {
      "uid": 812345678,
      "ar": 60
    }
  }
}
```

Errors: `not_found`, `rate_limited`.

### GET /api/v1/accounts/{id}/characters

Characters of the newest capture. The `characters` section of the newest capture's GOOD file, as stored. `?key=` keeps the entries whose `key` matches (comma-separated).

- Scope: snapshots · Read

- Bucket: `good` (6 / min free, 20 / min supporter, per account)

- Send `If-None-Match` for a 304 when unchanged.

Query:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "key": {
   "type": "string",
   "maxLength": 2000
  }
 }
}
```

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/characters" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "array",
 "items": {
  "type": "object",
  "propertyNames": {
   "type": "string"
  },
  "additionalProperties": {}
 }
}
```

Errors: `not_found`, `rate_limited`.

### GET /api/v1/accounts/{id}/weapons

Weapons of the newest capture. The `weapons` section of the newest capture's GOOD file, as stored. `?key=` keeps the entries whose `key` matches (comma-separated).

- Scope: snapshots · Read

- Bucket: `good` (6 / min free, 20 / min supporter, per account)

- Send `If-None-Match` for a 304 when unchanged.

Query:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "key": {
   "type": "string",
   "maxLength": 2000
  }
 }
}
```

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/weapons" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "array",
 "items": {
  "type": "object",
  "propertyNames": {
   "type": "string"
  },
  "additionalProperties": {}
 }
}
```

Errors: `not_found`, `rate_limited`.

### GET /api/v1/accounts/{id}/artifacts

Artifacts of the newest capture. The `artifacts` section of the newest capture's GOOD file, as stored. `?key=` keeps the entries whose `setKey` matches (comma-separated).

- Scope: snapshots · Read

- Bucket: `good` (6 / min free, 20 / min supporter, per account)

- Send `If-None-Match` for a 304 when unchanged.

Query:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "key": {
   "type": "string",
   "maxLength": 2000
  }
 }
}
```

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/artifacts" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "array",
 "items": {
  "type": "object",
  "propertyNames": {
   "type": "string"
  },
  "additionalProperties": {}
 }
}
```

Errors: `not_found`, `rate_limited`.

### GET /api/v1/accounts/{id}/materials

Materials of the newest capture. The `materials` section of the newest capture's GOOD file, as stored. `?key=` keeps the entries whose `key` matches (comma-separated).

- Scope: snapshots · Read

- Bucket: `good` (6 / min free, 20 / min supporter, per account)

- Send `If-None-Match` for a 304 when unchanged.

Query:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "key": {
   "type": "string",
   "maxLength": 2000
  }
 }
}
```

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/materials" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {
  "type": "number"
 }
}
```

Errors: `not_found`, `rate_limited`.

### GET /api/v1/accounts/{id}/snapshots/{snapshotId}/good

A snapshot as GOOD. That capture as GOOD. A stored snapshot never changes: cache it.

- Scope: snapshots · Read

- Bucket: `good` (6 / min free, 20 / min supporter, per account)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/snapshots/1/good" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "A GOOD file (version 3) with the `gi_*` keys"
}
```

Errors: `not_found`, `rate_limited`.

### POST /api/v1/accounts/{id}/snapshots

Upload a GOOD file. Send the file as `application/json` (gzip with `Content-Encoding: gzip`) or `multipart/form-data` with a `file` part. `?timestamp=` (Unix ms or ISO 8601) dates it when the file does not. The same data again is `unchanged` and stores nothing. Daily snapshot and storage quotas apply.

- Scope: snapshots · Write

- Bucket: `upload` (6 / min free, 20 / min supporter, per account)

Example:
```bash
curl -X POST "https://teyvat.me/api/v1/accounts/12/snapshots" \
  -H "Authorization: Bearer $TEYVAT_TOKEN" \
  -H "Content-Type: application/json" --data-binary @file.json
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "status": {
   "type": "string",
   "enum": [
    "created",
    "unchanged"
   ]
  },
  "snapshotId": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "takenAt": {
   "type": "string",
   "format": "date-time",
   "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
   "description": "ISO 8601, UTC"
  },
  "rawBytes": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "storedBytes": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "warnings": {
   "type": "array",
   "items": {
    "type": "object",
    "propertyNames": {
     "type": "string"
    },
    "additionalProperties": {}
   }
  }
 },
 "required": [
  "status",
  "snapshotId",
  "takenAt",
  "rawBytes",
  "storedBytes",
  "warnings"
 ],
 "additionalProperties": false
}
```

Errors: `too_many_items`, `key_too_long`, `daily_upload_limit`, `storage_quota`, `uploads_blocked`, `rate_limited`.

### DELETE /api/v1/accounts/{id}/snapshots/{snapshotId}

Delete a snapshot. Moves it to the trash (the website can restore it). Owner only.

- Scope: snapshots · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Example:
```bash
curl -X DELETE "https://teyvat.me/api/v1/accounts/12/snapshots/1" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer: 204 with no body.

Errors: `not_found`, `forbidden`, `rate_limited`.

### POST /api/v1/accounts/{id}/snapshots/compact

Compact history. Keeps the newest snapshot per day or Monday week (on the clock `offsetMinutes` from UTC) from before `before` (Unix ms) and deletes the rest at once, no trash. `dryRun` only counts. Owner only.

- Scope: snapshots · Write

- Bucket: `destructive` (2 / min free, 2 / min supporter, per account)

Body:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "keep": {
   "type": "string",
   "enum": [
    "day",
    "week"
   ]
  },
  "offsetMinutes": {
   "type": "integer",
   "minimum": -900,
   "maximum": 900
  },
  "before": {
   "anyOf": [
    {
     "type": "integer",
     "minimum": 0,
     "maximum": 9007199254740991
    },
    {
     "type": "null"
    }
   ]
  },
  "dryRun": {
   "type": "boolean"
  }
 },
 "required": [
  "keep",
  "offsetMinutes"
 ]
}
```

Example:
```bash
curl -X POST "https://teyvat.me/api/v1/accounts/12/snapshots/compact" \
  -H "Authorization: Bearer $TEYVAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"keep":"day","offsetMinutes":420,"before":1760000000000,"dryRun":true}'
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "kept": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "removed": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "dryRun": {
   "type": "boolean"
  }
 },
 "required": [
  "kept",
  "removed",
  "dryRun"
 ],
 "additionalProperties": false
}
```

### GET /api/v1/accounts/{id}/live

Live journal. What Capture sent since the newest snapshot (live sync): the changes as stored, GOOD-X paths and values. Apply them to `/good` yourself.

- Scope: snapshots · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/live" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "The open live journal: `open`, `base`, `seq`, `changes` (GOOD-X changes since the base)…"
}
```

### DELETE /api/v1/accounts/{id}/live

Discard the live journal.

- Scope: snapshots · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Example:
```bash
curl -X DELETE "https://teyvat.me/api/v1/accounts/12/live" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer: 204 with no body.

## Wishes

### GET /api/v1/accounts/{id}/wishes

List pulls. Every stored pull, newest first. `?banner=` keeps one UIGF banner type.

- Scope: wishes · Read

- Bucket: `read` (global only)

- Send `If-None-Match` for a 304 when unchanged.

Query:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "limit": {
   "default": 50,
   "description": "1–200, default 50",
   "type": "integer",
   "minimum": 1,
   "maximum": 200
  },
  "cursor": {
   "description": "`meta.nextCursor` of the page before",
   "type": "string",
   "maxLength": 400
  },
  "banner": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  }
 }
}
```

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/wishes?banner=301&limit=1" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "array",
 "items": {
  "type": "object",
  "properties": {
   "id": {
    "type": "string",
    "description": "The game’s id (synthetic below 10^18 for pulls from a paimon.moe backup)"
   },
   "banner": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991,
    "description": "UIGF type: 100, 200, 301 (and 400), 302, 500"
   },
   "gachaType": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991,
    "description": "The game’s type (400 = the second character banner)"
   },
   "time": {
    "type": "string",
    "description": "As the game writes it, on the account’s server clock: \"YYYY-MM-DD HH:MM:SS\""
   },
   "item": {
    "type": "object",
    "properties": {
     "key": {
      "description": "GOOD key; null when not in the table",
      "type": [
       "string",
       "null"
      ]
     },
     "kind": {
      "anyOf": [
       {
        "type": "string",
        "enum": [
         "character",
         "weapon"
        ]
       },
       {
        "type": "null"
       }
      ]
     },
     "name": {
      "type": "string"
     },
     "rarity": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
     },
     "itemId": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
     }
    },
    "required": [
     "key",
     "kind",
     "name",
     "rarity",
     "itemId"
    ],
    "additionalProperties": false
   }
  },
  "required": [
   "id",
   "banner",
   "gachaType",
   "time",
   "item"
  ],
  "additionalProperties": false
 }
}
```

Example answer:
```json
{
  "data": [
    {
      "id": "1731564000001234567",
      "banner": 301,
      "gachaType": 301,
      "time": "2026-11-12 18:21:04",
      "item": {
        "key": "Furina",
        "kind": "character",
        "name": "Furina",
        "rarity": 5,
        "itemId": 10000089
      }
    }
  ],
  "meta": {
    "nextCursor": "WzE3MzE1NjQwMDAsIjE3MzE1N…",
    "limit": 1,
    "timezone": 8,
    "total": 1840
  }
}
```

### GET /api/v1/accounts/{id}/wishes/summary

Wish summary. Computed: per banner the pity, the guarantee, the 50/50 record and the Capturing Radiance counter, as the Wish history page counts them (paimon.moe’s rules).

- Scope: wishes · Read

- Bucket: `wish-summary` (6 / min free, 20 / min supporter, per account)

- Send `If-None-Match` for a 304 when unchanged.

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/wishes/summary" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "timezone": {
   "anyOf": [
    {
     "type": "integer",
     "minimum": -9007199254740991,
     "maximum": 9007199254740991
    },
    {
     "type": "null"
    }
   ]
  },
  "banners": {
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "banner": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
     },
     "total": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
     },
     "pity5": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
     },
     "pity4": {
      "type": "integer",
      "minimum": -9007199254740991,
      "maximum": 9007199254740991
     },
     "guaranteed5": {
      "description": "The next 5★ is featured; null: no 50/50 here or not known",
      "type": [
       "boolean",
       "null"
      ]
     },
     "guaranteed4": {
      "type": [
       "boolean",
       "null"
      ]
     },
     "radiance": {
      "anyOf": [
       {
        "type": "integer",
        "minimum": -9007199254740991,
        "maximum": 9007199254740991
       },
       {
        "type": "null"
       }
      ],
      "description": "Capturing Radiance counter (0–3), character event only"
     },
     "five": {
      "type": "object",
      "properties": {
       "count": {
        "type": "integer",
        "minimum": -9007199254740991,
        "maximum": 9007199254740991
       },
       "share": {
        "type": "number"
       },
       "avgPity": {
        "type": "number"
       }
      },
      "required": [
       "count",
       "share",
       "avgPity"
      ],
      "additionalProperties": false
     },
     "four": {
      "type": "object",
      "properties": {
       "count": {
        "type": "integer",
        "minimum": -9007199254740991,
        "maximum": 9007199254740991
       },
       "share": {
        "type": "number"
       },
       "avgPity": {
        "type": "number"
       }
      },
      "required": [
       "count",
       "share",
       "avgPity"
      ],
      "additionalProperties": false
     },
     "rate5": {
      "anyOf": [
       {
        "type": "object",
        "properties": {
         "won": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
         },
         "lost": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
         },
         "radiance": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991,
          "description": "Wins that were certainly Capturing Radiance"
         },
         "rate": {
          "type": [
           "number",
           "null"
          ]
         },
         "winStreak": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
         },
         "maxWinStreak": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
         },
         "loseStreak": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
         },
         "maxLoseStreak": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
         }
        },
        "required": [
         "won",
         "lost",
         "radiance",
         "rate",
         "winStreak",
         "maxWinStreak",
         "loseStreak",
         "maxLoseStreak"
        ],
        "additionalProperties": false
       },
       {
        "type": "null"
       }
      ]
     },
     "rate4": {
      "anyOf": [
       {
        "type": "object",
        "properties": {
         "won": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
         },
         "lost": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
         },
         "radiance": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991,
          "description": "Wins that were certainly Capturing Radiance"
         },
         "rate": {
          "type": [
           "number",
           "null"
          ]
         },
         "winStreak": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
         },
         "maxWinStreak": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
         },
         "loseStreak": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
         },
         "maxLoseStreak": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
         }
        },
        "required": [
         "won",
         "lost",
         "radiance",
         "rate",
         "winStreak",
         "maxWinStreak",
         "loseStreak",
         "maxLoseStreak"
        ],
        "additionalProperties": false
       },
       {
        "type": "null"
       }
      ]
     },
     "fives": {
      "type": "array",
      "items": {
       "type": "object",
       "properties": {
        "id": {
         "type": "string"
        },
        "time": {
         "type": "string"
        },
        "item": {
         "type": "object",
         "properties": {
          "key": {
           "description": "GOOD key; null when not in the table",
           "type": [
            "string",
            "null"
           ]
          },
          "kind": {
           "anyOf": [
            {
             "type": "string",
             "enum": [
              "character",
              "weapon"
             ]
            },
            {
             "type": "null"
            }
           ]
          },
          "name": {
           "type": "string"
          },
          "rarity": {
           "type": "integer",
           "minimum": -9007199254740991,
           "maximum": 9007199254740991
          },
          "itemId": {
           "type": "integer",
           "minimum": -9007199254740991,
           "maximum": 9007199254740991
          }
         },
         "required": [
          "key",
          "kind",
          "name",
          "rarity",
          "itemId"
         ],
         "additionalProperties": false
        },
        "pity": {
         "type": "integer",
         "minimum": -9007199254740991,
         "maximum": 9007199254740991
        },
        "outcome": {
         "anyOf": [
          {
           "type": "string",
           "enum": [
            "won",
            "lost",
            "guaranteed",
            "radiance"
           ]
          },
          {
           "type": "null"
          }
         ]
        },
        "bannerName": {
         "type": [
          "string",
          "null"
         ]
        }
       },
       "required": [
        "id",
        "time",
        "item",
        "pity",
        "outcome",
        "bannerName"
       ],
       "additionalProperties": false
      }
     }
    },
    "required": [
     "banner",
     "total",
     "pity5",
     "pity4",
     "guaranteed5",
     "guaranteed4",
     "radiance",
     "five",
     "four",
     "rate5",
     "rate4",
     "fives"
    ],
    "additionalProperties": false
   }
  }
 },
 "required": [
  "timezone",
  "banners"
 ],
 "additionalProperties": false
}
```

### GET /api/v1/accounts/{id}/wishes/uigf

Export as UIGF. The whole history as a UIGF v4.1 file (a download, not the `{data}` envelope).

- Scope: wishes · Read

- Bucket: `wish-export` (2 / min free, 6 / min supporter, per account)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/wishes/uigf" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer: a file download (not the `{data}` envelope).

### POST /api/v1/accounts/{id}/wishes

Import wishes. A UIGF (v3 or v4) JSON, a paimon.moe CSV, Excel export or backup, as the body. Pulls already stored are skipped; a file with several accounts imports the one with this account’s UID.

- Scope: wishes · Write

- Bucket: `wish-import` (2 / min free, 6 / min supporter, per account)

Example:
```bash
curl -X POST "https://teyvat.me/api/v1/accounts/12/wishes" \
  -H "Authorization: Bearer $TEYVAT_TOKEN" \
  -H "Content-Type: application/json" --data-binary @file.json
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "added": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "known": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  },
  "skipped": {
   "type": "integer",
   "minimum": -9007199254740991,
   "maximum": 9007199254740991
  }
 },
 "required": [
  "added",
  "known",
  "skipped"
 ],
 "additionalProperties": false
}
```

Errors: `invalid_file`, `uid_required`, `uploads_blocked`, `rate_limited`.

### DELETE /api/v1/accounts/{id}/wishes

Delete every pull. At once, no trash. Owner only.

- Scope: wishes · Write

- Bucket: `destructive` (2 / min free, 2 / min supporter, per account)

Example:
```bash
curl -X DELETE "https://teyvat.me/api/v1/accounts/12/wishes" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer: 204 with no body.

## Progress

### GET /api/v1/accounts/{id}/achievements

Achievements marked by hand. Ids marked done by hand. What the capture says done is in the GOOD file (`/good`): the site shows the two together.

- Scope: progress · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/achievements" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "marked": {
   "type": "array",
   "items": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "description": "Ids marked done by hand; what the capture says done is in the GOOD file"
  }
 },
 "required": [
  "marked"
 ],
 "additionalProperties": false
}
```

### PATCH /api/v1/accounts/{id}/achievements

Mark achievements. `done` is applied before `undone`, so an id in both ends up unmarked.

- Scope: progress · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Body:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "done": {
   "default": [],
   "maxItems": 5000,
   "type": "array",
   "items": {
    "type": "integer",
    "exclusiveMinimum": 0,
    "maximum": 9007199254740991
   }
  },
  "undone": {
   "default": [],
   "maxItems": 5000,
   "type": "array",
   "items": {
    "type": "integer",
    "exclusiveMinimum": 0,
    "maximum": 9007199254740991
   }
  }
 }
}
```

Example:
```bash
curl -X PATCH "https://teyvat.me/api/v1/accounts/12/achievements" \
  -H "Authorization: Bearer $TEYVAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"done":[84001],"undone":[]}'
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "marked": {
   "type": "array",
   "items": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "description": "Ids marked done by hand; what the capture says done is in the GOOD file"
  }
 },
 "required": [
  "marked"
 ],
 "additionalProperties": false
}
```

### GET /api/v1/accounts/{id}/anecdotes

Anecdotes marked by hand. Ids marked done by hand. What the capture says done is in the GOOD file (`/good`): the site shows the two together.

- Scope: progress · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/anecdotes" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "marked": {
   "type": "array",
   "items": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "description": "Ids marked done by hand; what the capture says done is in the GOOD file"
  }
 },
 "required": [
  "marked"
 ],
 "additionalProperties": false
}
```

### PATCH /api/v1/accounts/{id}/anecdotes

Mark anecdotes. `done` is applied before `undone`, so an id in both ends up unmarked.

- Scope: progress · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Body:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "done": {
   "default": [],
   "maxItems": 2000,
   "type": "array",
   "items": {
    "type": "integer",
    "minimum": 100000,
    "maximum": 199999
   }
  },
  "undone": {
   "default": [],
   "maxItems": 2000,
   "type": "array",
   "items": {
    "type": "integer",
    "minimum": 100000,
    "maximum": 199999
   }
  }
 }
}
```

Example:
```bash
curl -X PATCH "https://teyvat.me/api/v1/accounts/12/anecdotes" \
  -H "Authorization: Bearer $TEYVAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"done":[100101],"undone":[]}'
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "marked": {
   "type": "array",
   "items": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "description": "Ids marked done by hand; what the capture says done is in the GOOD file"
  }
 },
 "required": [
  "marked"
 ],
 "additionalProperties": false
}
```

### GET /api/v1/accounts/{id}/quests

Quests marked by hand. Ids marked done by hand. What the capture says done is in the GOOD file (`/good`): the site shows the two together.

- Scope: progress · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/quests" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "marked": {
   "type": "array",
   "items": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "description": "Ids marked done by hand; what the capture says done is in the GOOD file"
  }
 },
 "required": [
  "marked"
 ],
 "additionalProperties": false
}
```

### PATCH /api/v1/accounts/{id}/quests

Mark quests. `done` is applied before `undone`, so an id in both ends up unmarked.

- Scope: progress · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Body:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "done": {
   "default": [],
   "maxItems": 5000,
   "type": "array",
   "items": {
    "type": "integer",
    "minimum": 1,
    "maximum": 99999999
   }
  },
  "undone": {
   "default": [],
   "maxItems": 5000,
   "type": "array",
   "items": {
    "type": "integer",
    "minimum": 1,
    "maximum": 99999999
   }
  }
 }
}
```

Example:
```bash
curl -X PATCH "https://teyvat.me/api/v1/accounts/12/quests" \
  -H "Authorization: Bearer $TEYVAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"done":[7017],"undone":[]}'
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "marked": {
   "type": "array",
   "items": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "description": "Ids marked done by hand; what the capture says done is in the GOOD file"
  }
 },
 "required": [
  "marked"
 ],
 "additionalProperties": false
}
```

## Planner

### GET /api/v1/accounts/{id}/planner/goals

Planner goals. Goals: characters, weapons, items, custom ones, as stored.

- Scope: planner · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/planner/goals" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "Goals: characters, weapons, items, custom ones"
}
```

### PATCH /api/v1/accounts/{id}/planner/goals

Change planner goals. The same body the website sends (`upsert` / `remove`); see the schema.

- Scope: planner · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Body:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "upsert": {
   "default": [],
   "maxItems": 1000,
   "type": "array",
   "items": {
    "oneOf": [
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "character"
       },
       "key": {
        "type": "string",
        "pattern": "^[A-Za-z0-9]{1,64}$"
       },
       "target": {
        "type": "object",
        "properties": {
         "level": {
          "type": "integer",
          "minimum": 1,
          "maximum": 90
         },
         "ascension": {
          "type": "integer",
          "minimum": 0,
          "maximum": 6
         },
         "talents": {
          "type": "object",
          "properties": {
           "auto": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10
           },
           "skill": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10
           },
           "burst": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10
           }
          },
          "required": [
           "auto",
           "skill",
           "burst"
          ]
         },
         "active": {
          "default": true,
          "type": "boolean"
         },
         "note": {
          "type": "string",
          "maxLength": 1000
         },
         "favorite": {
          "type": "boolean"
         },
         "priority": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100000
         },
         "constellation": {
          "type": "integer",
          "minimum": 0,
          "maximum": 6
         },
         "artifacts": {
          "type": "object",
          "properties": {
           "sets": {
            "maxItems": 8,
            "type": "array",
            "items": {
             "type": "object",
             "properties": {
              "key": {
               "type": "string",
               "pattern": "^[A-Za-z0-9]{1,64}$"
              },
              "done": {
               "type": "boolean"
              }
             },
             "required": [
              "key"
             ]
            }
           },
           "sands": {
            "maxItems": 16,
            "type": "array",
            "items": {
             "type": "string",
             "pattern": "^[A-Za-z_]{1,32}$"
            }
           },
           "goblet": {
            "maxItems": 16,
            "type": "array",
            "items": {
             "type": "string",
             "pattern": "^[A-Za-z_]{1,32}$"
            }
           },
           "circlet": {
            "maxItems": 16,
            "type": "array",
            "items": {
             "type": "string",
             "pattern": "^[A-Za-z_]{1,32}$"
            }
           },
           "slots": {
            "type": "object",
            "properties": {
             "flower": {
              "type": "boolean"
             },
             "plume": {
              "type": "boolean"
             },
             "sands": {
              "type": "boolean"
             },
             "goblet": {
              "type": "boolean"
             },
             "circlet": {
              "type": "boolean"
             }
            }
           }
          },
          "required": [
           "sets"
          ]
         },
         "unset": {
          "type": "boolean",
          "const": true
         }
        },
        "required": [
         "level",
         "ascension",
         "talents"
        ]
       }
      },
      "required": [
       "kind",
       "key",
       "target"
      ]
     },
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "item"
       },
       "key": {
        "type": "string",
        "pattern": "^[A-Za-z0-9]{1,64}$"
       },
       "target": {
        "type": "object",
        "properties": {
         "count": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000000000
         },
         "active": {
          "default": true,
          "type": "boolean"
         },
         "note": {
          "type": "string",
          "maxLength": 1000
         }
        },
        "required": [
         "count"
        ]
       }
      },
      "required": [
       "kind",
       "key",
       "target"
      ]
     },
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "weapon"
       },
       "key": {
        "type": "string",
        "pattern": "^[A-Za-z0-9]{1,64}$"
       },
       "owner": {
        "anyOf": [
         {
          "type": "string",
          "pattern": "^[A-Za-z0-9]{1,64}$"
         },
         {
          "type": "string",
          "const": ""
         }
        ]
       },
       "id": {
        "type": "string",
        "pattern": "^[a-z0-9]{6,32}$"
       },
       "target": {
        "type": "object",
        "properties": {
         "level": {
          "type": "integer",
          "minimum": 1,
          "maximum": 90
         },
         "ascension": {
          "type": "integer",
          "minimum": 0,
          "maximum": 6
         },
         "refinement": {
          "type": "integer",
          "minimum": 1,
          "maximum": 5
         },
         "active": {
          "default": true,
          "type": "boolean"
         },
         "note": {
          "type": "string",
          "maxLength": 1000
         },
         "priority": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100000
         },
         "custom": {
          "type": "object",
          "properties": {
           "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
           },
           "rarity": {
            "anyOf": [
             {
              "type": "number",
              "const": 3
             },
             {
              "type": "number",
              "const": 4
             },
             {
              "type": "number",
              "const": 5
             }
            ]
           },
           "type": {
            "type": "string",
            "enum": [
             "sword",
             "claymore",
             "polearm",
             "catalyst",
             "bow"
            ]
           },
           "ascension": {
            "type": "string",
            "pattern": "^[A-Za-z0-9]{1,64}$"
           },
           "elite": {
            "type": "string",
            "pattern": "^[A-Za-z0-9]{1,64}$"
           },
           "common": {
            "type": "string",
            "pattern": "^[A-Za-z0-9]{1,64}$"
           },
           "image": {
            "type": "string",
            "maxLength": 500,
            "format": "uri"
           }
          },
          "required": [
           "name",
           "rarity",
           "type"
          ]
         }
        },
        "required": [
         "level",
         "ascension",
         "refinement"
        ]
       }
      },
      "required": [
       "kind",
       "key",
       "owner",
       "target"
      ]
     },
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "custom"
       },
       "key": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9]{5,31}$"
       },
       "target": {
        "type": "object",
        "properties": {
         "level": {
          "type": "integer",
          "minimum": 1,
          "maximum": 90
         },
         "ascension": {
          "type": "integer",
          "minimum": 0,
          "maximum": 6
         },
         "talents": {
          "type": "object",
          "properties": {
           "auto": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10
           },
           "skill": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10
           },
           "burst": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10
           }
          },
          "required": [
           "auto",
           "skill",
           "burst"
          ]
         },
         "active": {
          "default": true,
          "type": "boolean"
         },
         "note": {
          "type": "string",
          "maxLength": 1000
         },
         "favorite": {
          "type": "boolean"
         },
         "priority": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100000
         },
         "constellation": {
          "type": "integer",
          "minimum": 0,
          "maximum": 6
         },
         "artifacts": {
          "type": "object",
          "properties": {
           "sets": {
            "maxItems": 8,
            "type": "array",
            "items": {
             "type": "object",
             "properties": {
              "key": {
               "type": "string",
               "pattern": "^[A-Za-z0-9]{1,64}$"
              },
              "done": {
               "type": "boolean"
              }
             },
             "required": [
              "key"
             ]
            }
           },
           "sands": {
            "maxItems": 16,
            "type": "array",
            "items": {
             "type": "string",
             "pattern": "^[A-Za-z_]{1,32}$"
            }
           },
           "goblet": {
            "maxItems": 16,
            "type": "array",
            "items": {
             "type": "string",
             "pattern": "^[A-Za-z_]{1,32}$"
            }
           },
           "circlet": {
            "maxItems": 16,
            "type": "array",
            "items": {
             "type": "string",
             "pattern": "^[A-Za-z_]{1,32}$"
            }
           },
           "slots": {
            "type": "object",
            "properties": {
             "flower": {
              "type": "boolean"
             },
             "plume": {
              "type": "boolean"
             },
             "sands": {
              "type": "boolean"
             },
             "goblet": {
              "type": "boolean"
             },
             "circlet": {
              "type": "boolean"
             }
            }
           }
          },
          "required": [
           "sets"
          ]
         },
         "unset": {
          "type": "boolean",
          "const": true
         },
         "custom": {
          "type": "object",
          "properties": {
           "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 40
           },
           "rarity": {
            "anyOf": [
             {
              "type": "number",
              "const": 4
             },
             {
              "type": "number",
              "const": 5
             }
            ]
           },
           "element": {
            "type": "string",
            "enum": [
             "Anemo",
             "Geo",
             "Electro",
             "Dendro",
             "Hydro",
             "Pyro",
             "Cryo"
            ]
           },
           "weapon": {
            "type": "string",
            "enum": [
             "sword",
             "claymore",
             "polearm",
             "catalyst",
             "bow"
            ]
           },
           "book": {
            "type": "string",
            "pattern": "^[A-Za-z0-9]{1,64}$"
           },
           "common": {
            "type": "string",
            "pattern": "^[A-Za-z0-9]{1,64}$"
           },
           "boss": {
            "type": "string",
            "pattern": "^[A-Za-z0-9]{1,64}$"
           },
           "local": {
            "type": "string",
            "pattern": "^[A-Za-z0-9]{1,64}$"
           },
           "weekly": {
            "type": "string",
            "pattern": "^[A-Za-z0-9]{1,64}$"
           },
           "image": {
            "type": "string",
            "maxLength": 500,
            "format": "uri"
           },
           "banner": {
            "type": "string",
            "maxLength": 500,
            "format": "uri"
           }
          },
          "required": [
           "name",
           "rarity",
           "element",
           "weapon"
          ]
         }
        },
        "required": [
         "level",
         "ascension",
         "talents",
         "custom"
        ]
       }
      },
      "required": [
       "kind",
       "key",
       "target"
      ]
     }
    ]
   }
  },
  "remove": {
   "default": [],
   "maxItems": 1000,
   "type": "array",
   "items": {
    "oneOf": [
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "character"
       },
       "key": {
        "type": "string",
        "pattern": "^[A-Za-z0-9]{1,64}$"
       }
      },
      "required": [
       "kind",
       "key"
      ]
     },
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "item"
       },
       "key": {
        "type": "string",
        "pattern": "^[A-Za-z0-9]{1,64}$"
       }
      },
      "required": [
       "kind",
       "key"
      ]
     },
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "weapon"
       },
       "key": {
        "type": "string",
        "pattern": "^[A-Za-z0-9]{1,64}$"
       },
       "owner": {
        "anyOf": [
         {
          "type": "string",
          "pattern": "^[A-Za-z0-9]{1,64}$"
         },
         {
          "type": "string",
          "const": ""
         }
        ]
       },
       "id": {
        "type": "string",
        "pattern": "^[a-z0-9]{6,32}$"
       }
      },
      "required": [
       "kind",
       "key",
       "owner"
      ]
     },
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "custom"
       },
       "key": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9]{5,31}$"
       }
      },
      "required": [
       "kind",
       "key"
      ]
     }
    ]
   }
  }
 }
}
```

Example:
```bash
curl -X PATCH "https://teyvat.me/api/v1/accounts/12/planner/goals" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "Goals: characters, weapons, items, custom ones"
}
```

Errors: `capture_changed`, `invalid_request`, `rate_limited`.

### GET /api/v1/accounts/{id}/planner/state

Planner state. Hand edits to materials and current levels, as stored.

- Scope: planner · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/planner/state" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "Hand edits to materials and current levels"
}
```

### PATCH /api/v1/accounts/{id}/planner/state

Change planner state. The same body the website sends (`upsert` / `remove`); see the schema.

- Scope: planner · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Body:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "base": {
   "type": "integer",
   "minimum": 0,
   "maximum": 9007199254740991
  },
  "inventory": {
   "default": [],
   "maxItems": 1000,
   "type": "array",
   "items": {
    "type": "object",
    "properties": {
     "key": {
      "type": "string",
      "pattern": "^[A-Za-z0-9]{1,64}$"
     },
     "set": {
      "anyOf": [
       {
        "type": "integer",
        "minimum": 0,
        "maximum": 1000000000
       },
       {
        "type": "null"
       }
      ]
     },
     "add": {
      "type": "integer",
      "minimum": -1000000000,
      "maximum": 1000000000
     }
    },
    "required": [
     "key"
    ]
   }
  },
  "current": {
   "default": [],
   "maxItems": 1000,
   "type": "array",
   "items": {
    "oneOf": [
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "character"
       },
       "key": {
        "type": "string",
        "pattern": "^[A-Za-z0-9]{1,64}$"
       },
       "current": {
        "anyOf": [
         {
          "type": "object",
          "properties": {
           "level": {
            "type": "integer",
            "minimum": 1,
            "maximum": 90
           },
           "ascension": {
            "type": "integer",
            "minimum": 0,
            "maximum": 6
           },
           "talents": {
            "type": "object",
            "properties": {
             "auto": {
              "type": "integer",
              "minimum": 1,
              "maximum": 10
             },
             "skill": {
              "type": "integer",
              "minimum": 1,
              "maximum": 10
             },
             "burst": {
              "type": "integer",
              "minimum": 1,
              "maximum": 10
             }
            },
            "required": [
             "auto",
             "skill",
             "burst"
            ]
           }
          },
          "required": [
           "level",
           "ascension",
           "talents"
          ]
         },
         {
          "type": "null"
         }
        ]
       }
      },
      "required": [
       "kind",
       "key",
       "current"
      ]
     },
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "weapon"
       },
       "key": {
        "type": "string",
        "pattern": "^[A-Za-z0-9]{1,64}$"
       },
       "owner": {
        "anyOf": [
         {
          "type": "string",
          "pattern": "^[A-Za-z0-9]{1,64}$"
         },
         {
          "type": "string",
          "const": ""
         }
        ]
       },
       "id": {
        "type": "string",
        "pattern": "^[a-z0-9]{6,32}$"
       },
       "current": {
        "anyOf": [
         {
          "type": "object",
          "properties": {
           "level": {
            "type": "integer",
            "minimum": 1,
            "maximum": 90
           },
           "ascension": {
            "type": "integer",
            "minimum": 0,
            "maximum": 6
           },
           "refinement": {
            "type": "integer",
            "minimum": 1,
            "maximum": 5
           }
          },
          "required": [
           "level",
           "ascension",
           "refinement"
          ]
         },
         {
          "type": "null"
         }
        ]
       }
      },
      "required": [
       "kind",
       "key",
       "owner",
       "current"
      ]
     },
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "custom"
       },
       "key": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9]{5,31}$"
       },
       "current": {
        "anyOf": [
         {
          "type": "object",
          "properties": {
           "level": {
            "type": "integer",
            "minimum": 1,
            "maximum": 90
           },
           "ascension": {
            "type": "integer",
            "minimum": 0,
            "maximum": 6
           },
           "talents": {
            "type": "object",
            "properties": {
             "auto": {
              "type": "integer",
              "minimum": 1,
              "maximum": 10
             },
             "skill": {
              "type": "integer",
              "minimum": 1,
              "maximum": 10
             },
             "burst": {
              "type": "integer",
              "minimum": 1,
              "maximum": 10
             }
            },
            "required": [
             "auto",
             "skill",
             "burst"
            ]
           }
          },
          "required": [
           "level",
           "ascension",
           "talents"
          ]
         },
         {
          "type": "null"
         }
        ]
       }
      },
      "required": [
       "kind",
       "key",
       "current"
      ]
     }
    ]
   }
  },
  "prune": {
   "type": "boolean"
  }
 },
 "required": [
  "base"
 ]
}
```

Example:
```bash
curl -X PATCH "https://teyvat.me/api/v1/accounts/12/planner/state" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "Hand edits to materials and current levels"
}
```

Errors: `capture_changed`, `invalid_request`, `rate_limited`.

### GET /api/v1/accounts/{id}/planner/tasks

Planner tasks. Built-in and custom tasks, as stored.

- Scope: planner · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/planner/tasks" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "Built-in and custom tasks"
}
```

### PATCH /api/v1/accounts/{id}/planner/tasks

Change planner tasks. The same body the website sends (`upsert` / `remove`); see the schema.

- Scope: planner · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Body:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "upsert": {
   "default": [],
   "maxItems": 500,
   "type": "array",
   "items": {
    "oneOf": [
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "builtin"
       },
       "id": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9-]{1,31}$"
       },
       "next": {
        "anyOf": [
         {
          "type": "integer",
          "minimum": 0,
          "maximum": 8640000000000000
         },
         {
          "type": "null"
         }
        ]
       },
       "hidden": {
        "type": "boolean"
       }
      },
      "required": [
       "kind",
       "id"
      ]
     },
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "custom"
       },
       "id": {
        "type": "string",
        "pattern": "^[a-z0-9]{6,32}$"
       },
       "task": {
        "type": "object",
        "properties": {
         "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 80
         },
         "every": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
         },
         "mode": {
          "type": "string",
          "enum": [
           "original",
           "completed"
          ]
         },
         "note": {
          "type": "string",
          "maxLength": 1000
         }
        },
        "required": [
         "name",
         "every",
         "mode"
        ]
       },
       "due": {
        "type": "string",
        "pattern": "^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$"
       },
       "position": {
        "type": "integer",
        "minimum": 0,
        "maximum": 100000
       }
      },
      "required": [
       "kind",
       "id",
       "task",
       "due"
      ]
     }
    ]
   }
  },
  "remove": {
   "default": [],
   "maxItems": 500,
   "type": "array",
   "items": {
    "oneOf": [
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "builtin"
       },
       "id": {
        "type": "string",
        "pattern": "^[a-z][a-z0-9-]{1,31}$"
       }
      },
      "required": [
       "kind",
       "id"
      ]
     },
     {
      "type": "object",
      "properties": {
       "kind": {
        "type": "string",
        "const": "custom"
       },
       "id": {
        "type": "string",
        "pattern": "^[a-z0-9]{6,32}$"
       }
      },
      "required": [
       "kind",
       "id"
      ]
     }
    ]
   }
  }
 }
}
```

Example:
```bash
curl -X PATCH "https://teyvat.me/api/v1/accounts/12/planner/tasks" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "Built-in and custom tasks"
}
```

Errors: `capture_changed`, `invalid_request`, `rate_limited`.

### GET /api/v1/accounts/{id}/planner/farm

Farm plan. Computed: every active goal together, costed with the Planner’s own math against the newest capture’s bag (with your hand edits), then what is still missing, the farm estimates (resin, runs, domains, weekly bosses, ley lines) and what today’s open domains can farm on the account’s server. The Farm view also applies the goals’ priority order and its filters; this is the plan for all goals at once. Custom characters and weapons are listed in `skipped`.

- Scope: planner · Read

- Bucket: `farm` (6 / min free, 20 / min supporter, per account)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/planner/farm" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "`missing` materials, `plan` (groups, domains, weekly, leyLines, total), `today`, `mora`, EXP totals"
}
```

## Sharing

### GET /api/v1/accounts/{id}/members

Who can see an account.

- Scope: sharing · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/members" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "array",
 "items": {
  "type": "object",
  "properties": {
   "userId": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "username": {
    "type": "string"
   },
   "role": {
    "type": "string",
    "enum": [
     "owner",
     "editor",
     "viewer"
    ]
   },
   "invitedAt": {
    "type": "string",
    "format": "date-time",
    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
    "description": "ISO 8601, UTC"
   },
   "acceptedAt": {
    "anyOf": [
     {
      "type": "string",
      "format": "date-time",
      "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
      "description": "ISO 8601, UTC"
     },
     {
      "type": "null"
     }
    ],
    "description": "null: invited, not accepted yet"
   }
  },
  "required": [
   "userId",
   "username",
   "role",
   "invitedAt",
   "acceptedAt"
  ],
  "additionalProperties": false
 }
}
```

### POST /api/v1/accounts/{id}/members

Invite someone. By exact username, as viewer or editor. Owner only; they accept on the website.

- Scope: sharing · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Body:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "username": {
   "type": "string",
   "minLength": 1,
   "maxLength": 64
  },
  "role": {
   "type": "string",
   "enum": [
    "viewer",
    "editor"
   ]
  }
 },
 "required": [
  "username",
  "role"
 ]
}
```

Example:
```bash
curl -X POST "https://teyvat.me/api/v1/accounts/12/members" \
  -H "Authorization: Bearer $TEYVAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"friend02","role":"viewer"}'
```

Answer: 201 with no body.

Errors: `not_found`, `forbidden`, `already_member`, `too_many_members`, `rate_limited`.

### PATCH /api/v1/accounts/{id}/members/{userId}

Change a member’s role.

- Scope: sharing · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Body:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "role": {
   "type": "string",
   "enum": [
    "viewer",
    "editor"
   ]
  }
 },
 "required": [
  "role"
 ]
}
```

Example:
```bash
curl -X PATCH "https://teyvat.me/api/v1/accounts/12/members/1" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer: 204 with no body.

### DELETE /api/v1/accounts/{id}/members/{userId}

Remove a member (or leave).

- Scope: sharing · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Example:
```bash
curl -X DELETE "https://teyvat.me/api/v1/accounts/12/members/1" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer: 204 with no body.

### GET /api/v1/invitations

Invitations to you.

- Scope: sharing · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/invitations" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "array",
 "items": {
  "type": "object",
  "properties": {
   "accountId": {
    "type": "integer",
    "minimum": -9007199254740991,
    "maximum": 9007199254740991
   },
   "accountName": {
    "type": [
     "string",
     "null"
    ]
   },
   "uid": {
    "type": [
     "string",
     "null"
    ]
   },
   "owner": {
    "type": "string"
   },
   "role": {
    "type": "string",
    "enum": [
     "editor",
     "viewer"
    ]
   },
   "invitedAt": {
    "type": "string",
    "format": "date-time",
    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z))$",
    "description": "ISO 8601, UTC"
   }
  },
  "required": [
   "accountId",
   "accountName",
   "uid",
   "owner",
   "role",
   "invitedAt"
  ],
  "additionalProperties": false
 }
}
```

### POST /api/v1/invitations/{accountId}/accept

Accept an invitation.

- Scope: sharing · Write

- Bucket: `write` (10 / min free, 30 / min supporter)

Example:
```bash
curl -X POST "https://teyvat.me/api/v1/invitations/1/accept" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer: 204 with no body.

Errors: `not_found`, `rate_limited`.

### POST /api/v1/invitations/{accountId}/decline

Decline an invitation.

- Scope: sharing · Write

- Bucket: `write` (10 / min free, 30 / min supporter)

Example:
```bash
curl -X POST "https://teyvat.me/api/v1/invitations/1/decline" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer: 204 with no body.

Errors: `not_found`, `rate_limited`.

## Capture

### GET /api/v1/accounts/{id}/presence

Is Capture playing it. Teyvat.me Capture’s presence for the account, and commands waiting for it.

- Scope: capture · Read

- Bucket: `read` (global only)

Example:
```bash
curl "https://teyvat.me/api/v1/accounts/12/presence" \
  -H "Authorization: Bearer $TEYVAT_TOKEN"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "`presence` (null: Capture is not playing it) and `pending` commands"
}
```

### POST /api/v1/accounts/{id}/capture-commands

Ask Capture to sync. `wishes` (sync the wish history) or `snapshot` (send a full capture). 409 `not_playing` when Capture isn’t on the account.

- Scope: capture · Write

- Bucket: `write` (10 / min free, 30 / min supporter, per account)

Body:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "kind": {
   "type": "string",
   "enum": [
    "wishes",
    "snapshot"
   ]
  }
 },
 "required": [
  "kind"
 ]
}
```

Example:
```bash
curl -X POST "https://teyvat.me/api/v1/accounts/12/capture-commands" \
  -H "Authorization: Bearer $TEYVAT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind":"snapshot"}'
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "The presence after the command"
}
```

Errors: `not_playing`, `rate_limited`.

## Game events

### GET /api/v1/game-events

Current and upcoming events. What the site lists: domain event windows and the notice board’s events. No token needed (limited per IP).

- Scope: none (no token)

- Bucket: `read` (global only)

Query:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "properties": {
  "server": {
   "description": "asia, europe, america, tw_hk_mo, cn",
   "type": "string",
   "maxLength": 16
  }
 }
}
```

Example:
```bash
curl "https://teyvat.me/api/v1/game-events"
```

Answer `data`:
```json
{
 "$schema": "https://json-schema.org/draft/2020-12/schema",
 "type": "object",
 "propertyNames": {
  "type": "string"
 },
 "additionalProperties": {},
 "description": "`domain` windows, `notices`, `syncedAt`"
}
```
