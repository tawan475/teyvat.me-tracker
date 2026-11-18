# Third-party notices

The tracker's own code is MIT licensed (see [`LICENSE`](LICENSE)). Parts of
it come from the projects below. paimon.moe and Genshin Optimizer are MIT
licensed too; their copyright and permission notices are reproduced here, as
their licences require. Seelie is credited for the identifiers we read from
it. Game content inside these files stays HoYoverse's and is covered by none
of these licences (see the README's "Licence" section).

## paimon.moe

Wish banner dates and featured items and the English character and weapon
names of the wish history come from
[paimon.moe](https://github.com/MadeBaruna/paimon-moe) by Made Baruna,
through `apps/tracker/scripts/wish-data.mjs`:

- `apps/tracker/src/data/wish-banners.json` (adapted from `banners.js` and
  `bannersDual.js`)
- `packages/shared/src/wish/items.json` (names from `characters.js` and
  `weaponList.js`)

The pity and 50/50 figures in `apps/tracker/src/data/wish-history.ts` follow
paimon.moe's definitions. The character, weapon and banner names in these
files are HoYoverse's.

```
MIT License

Copyright (c) 2021 Made Baruna

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Genshin Optimizer

The GOOD format (Genshin Open Object Description) comes from
[Genshin Optimizer](https://github.com/frzyc/genshin-optimizer) by frzyc and
its contributors, and with it `toGoodKey()` in `packages/shared/src/good.ts`.
`apps/tracker/src/data/artifact-stats.ts` was generated once from Genshin
Optimizer's `allStat_gen.json` (master @ 7348b03b8314; the file's header
names it).

```
MIT License

Copyright (c) 2020-present, frzyc

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Seelie

`apps/tracker/src/components/planner/seelie-slugs.ts` lists the identifiers
[Seelie](https://seelie.me) uses in its export files (item slugs mapped to
game ids, and the spellings of names, main stats and elements), read from
seelie.me's public site. They are kept only so that Seelie exports can be
imported here and our plans exported back in Seelie's format. No Seelie code
is copied into this repository.

Teyvat.me is not affiliated with or endorsed by Seelie.
