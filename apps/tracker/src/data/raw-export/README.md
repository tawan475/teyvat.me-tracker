# Teyvat.me raw download

Your snapshots exactly as Teyvat.me stores them: compressed, deduplicated,
nothing decoded. For developers; the normal Download gives GOOD files.

Run `node inflate.mjs` in this folder (Node 18+, no packages: the site's own
decoder is bundled inside it) to turn everything into readable JSON in
`inflated/`:

| Output                                   | What                                                                                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inflated/snapshots/leyline-<time>.json` | Each snapshot whole, as a Leyline file (GOOD + `gi_*`): the same content the site's Download gives. Captures that share a second get `_<id>` appended. |
| `inflated/sections/<id>.json`            | Each stored section decoded to its canonical value (names as dictionary ids; a delta holds only what changed against its keyframe).                    |
| `inflated/catalog.json`                  | Every artifact identity, by catalog id.                                                                                                                |

Short arrays and objects stay on one line, so the files read well in an
editor. Whole snapshots are large: about 1 MB of JSON each, against a few
hundred bytes stored.

## Files

| File                         | What                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `snapshots.json`             | One entry per snapshot: `id`, `takenAt`, `lastSeenAt` (ms), `source`, and per section the **id of its blob** in `sections/` (`artifactsBase`, `materialsKeyframe`, `achievementTimesBase`: the keyframe a delta applies to). `playerVars`: the per-login player values kept beside the player section. |
| `sections.json`              | One entry per blob: `id`, `kind`, `delta` (a delta of its base), `base` (the blob it is compressed against or is a delta of; null for none), `file`, `bytes`.                                                                                                                                          |
| `sections/<id>.bin`          | A blob as stored.                                                                                                                                                                                                                                                                                      |
| `catalog.json`               | The artifact catalog: `chunks` (each `first`–`last` artifact id, `count`, `file`) and `pending` (identities an import had not packed into a chunk yet, as JSON rows).                                                                                                                                  |
| `catalog/<first>-<last>.bin` | A catalog chunk as stored.                                                                                                                                                                                                                                                                             |
| `inflate.mjs`                | The script (bundled from the tracker's `src/data/raw-export/inflate.ts`).                                                                                                                                                                                                                              |

## Section blobs

Byte 0 is the format: high nibble = layout (`0x00` JSON, `0x10` binary),
low nibble = compression:

- `0` stored: the body follows as is;
- `1` deflated: raw DEFLATE (RFC 1951);
- `2` deflated against its base: raw DEFLATE with the **base's payload** as
  the preset dictionary. A payload is the layout byte followed by the
  inflated body.

A blob is at most two steps from a standalone one, so a reader inflates at
most a delta, its keyframe and the keyframe's dictionary.

After inflating, a JSON section is the canonical section value; a binary one
is the layout in `packages/shared/src/codec/section-binary.ts`. Kinds:
characters, weapons, artifacts (catalog ids + per-snapshot state), materials,
achievements, player, achievementTimes, characterExtras, anecdotes, tasks,
collections, collections2, wardrobe, exploration, progress, extras. A delta
(`delta: true`) holds only what changed against its keyframe.

## Catalog chunks

Byte 0: `1` stored, `2` raw DEFLATE. Inside: a count, the artifact ids as
zigzag varint deltas, then each identity packed (layout at the top of
`packages/shared/src/codec/catalog-binary.ts`).

## Sources

The codec is open: https://github.com/tawan475/teyvat.me-tracker/tree/main/packages/shared/src/codec
(`section-blob.ts`, `section-binary.ts`, `sections.ts`, `catalog-binary.ts`, `store-v2.ts`).
