# Stygian Onslaught co-op records: the other players' characters

Planning notes, 2026-11-06. The user noticed that a co-op record on the
Endgame page and the share card shows only the account's own one or two
characters per battlefield, while the game's record screen shows all four
with a 1P/2P/3P tag on each, and a participant list (profile picture,
name, tag) at the left.

## What the data holds today (rechecked)

The game's reply when the Stygian menu opens (7.1 id 4056; Capture
`crates/protocol/src/endgame.rs`) carries, per record, `player_info_list`
(each player's **index** = the 1P/2P/3P position, their UID, their profile
picture) and, per fight, `team_info_list`: one entry per player with their
UID and their `avatar_info_list`, where each avatar has its **id, level,
constellation** (fields 1–3 in the fixture modelled on the real message)
and a fourth small number. So the game sends everything its screen draws
except, possibly, the nicknames: the fixture has none, and whether the real
message carries them or the client fetches them separately needs one trace
of a real reply (`RUST_LOG=teyvatme_protocol=trace teyvatme --replay-export
<out> <recording>` on `E:/gdt-playground/recordings/user-2026-11-06`).

Capture **drops it on purpose**: `apply_stygian_records` keeps only the
team whose UID is the account's and exports GOOD keys alone (contract v1
`gi_endgame.stygian.records[].fights[].team`; "the other players' teams and
UIDs are never exported"). So this is a data gap in Capture first, then a
display gap in the tracker. The tracker's tiles show level and constellation
from the account's newest capture, which can't exist for another player's
character.

## The contract change (additive: old keys stay, new ones optional)

```jsonc
"records": [{
  "season": 5269012, "difficulty": 6, "at": 1791900000, "coop": true,
  // NEW: the players in the game's order (1P, 2P, 3P). Never a UID.
  "players": [
    { "p": 1, "self": false, "picture": 1023, "nickname": "Starxor" },   // picture: ProfilePicture id; both optional
    { "p": 2, "self": true,  "picture": 2 }
  ],
  "fights": [{
    "time": 55, "done": true,
    "team": ["Mavuika", "Xilonen"],                   // as today: the account's own
    // NEW: every character of the fight, by player, with the record's own
    // level and constellation (what the game's screen shows).
    "players": [
      { "p": 1, "team": [{ "key": "Furina", "level": 100, "constellation": 6 }, …] },
      { "p": 2, "team": [{ "key": "Mavuika", "level": 90, "constellation": 6 }, …] }
    ],
    "strike": …, "damage": …
  }]
}]
```

- `nickname` on a player: **yes (the user's call, 2026-11-06), when the
  message has it** (the trace decides; if the client fetches names apart
  from the record, they are not read). The share card's Name toggle hides
  them together with the owner's own name.
- UIDs of other players stay out, as now. `self` marks the owner.
- Old Capture builds keep sending `team` only; the tracker falls back to
  today's view.

Capture: `StygianTeam` gains level and constellation per avatar
(`avatar_info` fields 2 and 3), `StygianRecord` gains the player list with
index and picture; `apply_stygian_records` keeps every team, maps ids to
GOOD keys, marks `self` by UID and drops the UIDs. Tests from the fixtures
(a 3-player record, a 2-player one, a solo one). Contract v1 note in
`E:/gdt-playground/refs/endgame/CONTRACT.md`. A Capture patch release.

Tracker: `GiStygianRecord`/`GiStygianFight` gain the optional fields in
`packages/shared/src/good.ts`; the extras part `e` encoder carries them (a
new `pre<N>ContentHash` era so re-uploads of older captures stay no-ops);
`normalizeGood` range-checks (`p` 1–4, level 1–100, constellation 0–6, ≤ 4
characters a player, ≤ 4 players).

## The display (both places)

**Endgame page, "Your records" cards** (`StygianSeason.vue`): a co-op
fight lists all four portraits in player order, each with a small 1P/2P/3P
tag (text, not colour alone); the record card's header gets the players
("with 1P, 3P" and their pictures where exported, "You" on the owner).

**Share card** (`stygian-card.ts` / `-canvas.ts`, design F): in a co-op
record,

1. the four tiles of a fight are the union of the players' teams in player
   order; each tile gets a **player tag at its bottom-left** (the free
   corner: element top-left, constellation top-right stay as designed),
   coloured like the game's (1P green, 2P blue, 3P pink) but always with
   the "1P" text and differing in lightness, so it reads without colour;
2. level and constellation on every tile come **from the record** (what
   the game shows), not from the newest capture, since the message now
   carries them for everyone; the solo card keeps today's rule unless the
   user prefers record-time values everywhere (open);
3. a **participants strip** under the header, 44px tall, only on co-op
   cards: the players in order, each a round profile picture (where
   exported, else the tag alone), the tag and "You" / the nickname (when
   the Name option is on). The boss art gives up those 66px
   (strip + gap); the columns are otherwise unchanged. The pill's
   "Co-op" is already implied by the strip; the season panel is untouched.

A mockup of the co-op card goes on the design canvas before building
(the user picks between the bottom-left tag and a tag replacing the
constellation chip, if the corner looks crowded).

## Steps

1. Trace one real 4056 reply (the 2026-11-06 recording) and write down the
   player and avatar fields: index, picture, nickname (present or not),
   level, constellation, the fourth number.
2. Contract + Capture export + tests; patch release.
3. Tracker: shared types, extras encoding, normalizeGood, tests.
4. Endgame page cards.
5. Share card: mockup on the canvas, then `stygian-card.ts` geometry (the
   strip, the tag), the painter, tests, both themes rendered.

Size: about a day for Capture, two for the tracker, after the trace.

## Open

- Record-time level/constellation on solo cards too, for one rule everywhere.
- The tag's corner (bottom-left, or in place of the constellation chip).
