/**
 * Guides per character: the Guides button and section in the character
 * detail (GuidesSection.vue, GuidesDialog.vue). Edit `characterGuides`
 * freely, no code needed:
 * - `prydwen`, `kqm`, `helper`: the three sites, always shown in that order.
 *   Without `url` a site's page is made from the key in kebab case
 *   (`RaidenShogun` → prydwen.gg/genshin-impact/characters/raiden-shogun,
 *   keqingmains.com/raiden-shogun/, …/genshin-builds/en/raiden-shogun/);
 *   give `url` where the site's page differs. Prydwen's page is always the
 *   key's slug, so it links there even for a character not listed yet (a
 *   new release; the user's point, 2026-11-05: Mitya showed "Search"); KQM
 *   and Helper Team name pages by hand, so a character (or site) not listed
 *   links to that site's search.
 * - `youtube`: a video (`watch?v=`, `youtu.be/` or `shorts/` link) with its
 *   `title` and `channel`; listed in this order.
 * - `link`: any other page, with a `title`; after the three sites.
 * The pages below were checked on 2026-10-28 (Prydwen's character list,
 * KQM's guides and quick guides, Helper Team's character pages). On
 * 2026-11-05 Mitya and Valeriy (7.2) had no KQM page and Helper Team's
 * were still WIP (404): add them here once those sites publish.
 */

export type GuideType = 'prydwen' | 'kqm' | 'helper' | 'youtube' | 'link'

export interface Guide {
  type: GuideType
  url?: string
  title?: string
  channel?: string
}

/** Per character GOOD key. Order within a group is display order. */
export const characterGuides: Record<string, Guide[]> = {
  Aino: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/aino-quickguide/' },
    { type: 'helper' },
  ],
  Albedo: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Alhaitham: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/alhaitham-quickguide/' },
    { type: 'helper' },
  ],
  Aloy: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Alyosha: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/alyosha-quickguide/' },
    { type: 'helper' },
  ],
  Amber: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  AratakiItto: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/itto/' },
    { type: 'helper' },
  ],
  Arlecchino: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/arlecchino-quickguide/' },
    { type: 'helper' },
  ],
  Baizhu: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Barbara: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Beidou: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Bennett: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Candace: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Charlotte: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/charlotte-quickguide/' },
    { type: 'helper' },
  ],
  Chasca: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/chasca-quickguide/' },
    { type: 'helper' },
  ],
  Chevreuse: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/chevreuse-quickguide/' },
    { type: 'helper' },
  ],
  Chiori: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/chiori-quickguide/' },
    { type: 'helper' },
  ],
  Chongyun: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Citlali: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/citlali-quickguide/' },
    { type: 'helper' },
  ],
  Clorinde: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/clorinde-quickguide/' },
    { type: 'helper' },
  ],
  Collei: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Columbina: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/columbina-quickguide/' },
    { type: 'helper' },
  ],
  Cyno: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/cyno-quickguide/' },
    { type: 'helper' },
  ],
  Dahlia: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/dahlia-quickguide/' },
    { type: 'helper' },
  ],
  Dehya: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Diluc: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Diona: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Dori: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/dori-quickguide/' },
    { type: 'helper' },
  ],
  Durin: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/durin-quickguide/' },
    { type: 'helper' },
  ],
  Emilie: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/emilie-quickguide/' },
    { type: 'helper' },
  ],
  Escoffier: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/escoffier-quickguide/' },
    { type: 'helper' },
  ],
  Eula: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Faruzan: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Fischl: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Flins: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/flins-quickguide/' },
    { type: 'helper' },
  ],
  Freminet: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/freminet-quickguide/' },
    { type: 'helper' },
  ],
  Furina: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Gaming: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/gaming-quickguide/' },
    { type: 'helper' },
  ],
  Ganyu: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Gorou: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  HuTao: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Iansan: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/iansan-quickguide/' },
    { type: 'helper' },
  ],
  Ifa: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/ifa-quickguide/' },
    { type: 'helper' },
  ],
  Illuga: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/illuga-quickguide/' },
    { type: 'helper' },
  ],
  Ineffa: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/ineffa-quickguide/' },
    { type: 'helper' },
  ],
  Jahoda: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/jahoda-quickguide/' },
    { type: 'helper' },
  ],
  Jean: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Kachina: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/kachina-quickguide/' },
    { type: 'helper' },
  ],
  KaedeharaKazuha: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/kazuha/' },
    { type: 'helper' },
  ],
  Kaeya: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  KamisatoAyaka: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/ayaka/' },
    { type: 'helper' },
  ],
  KamisatoAyato: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/ayato/' },
    { type: 'helper' },
  ],
  Kaveh: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Keqing: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Kinich: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/kinich-quickguide/' },
    { type: 'helper' },
  ],
  Kirara: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Klee: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  KujouSara: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/sara/' },
    { type: 'helper' },
  ],
  KukiShinobu: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/shinobu-quickguide/' },
    { type: 'helper' },
  ],
  LanYan: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/lan-yan-quickguide/' },
    { type: 'helper' },
  ],
  Lauma: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/lauma-quickguide/' },
    { type: 'helper' },
  ],
  Layla: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Linnea: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/linnea-quickguide/' },
    { type: 'helper' },
  ],
  Lisa: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Lohen: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/lohen-quickguide/' },
    { type: 'helper' },
  ],
  Lynette: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/lynette-quickguide/' },
    { type: 'helper' },
  ],
  Lyney: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/lyney-quickguide/' },
    { type: 'helper' },
  ],
  Mavuika: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/mavuika-quickguide/' },
    { type: 'helper' },
  ],
  Mika: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Mona: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Mualani: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/mualani-quickguide/' },
    { type: 'helper' },
  ],
  Nahida: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Navia: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Nefer: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/nefer-quickguide/' },
    { type: 'helper' },
  ],
  Neuvillette: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Nicole: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/nicole-quickguide/' },
    { type: 'helper' },
  ],
  Nilou: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Ningguang: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Noelle: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Odette: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/odette-quickguide/' },
    { type: 'helper' },
  ],
  Ororon: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/ororon-quickguide/' },
    { type: 'helper' },
  ],
  Prune: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/prune-quickguide/' },
    { type: 'helper' },
  ],
  Qiqi: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  RaidenShogun: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/raiden/' },
    {
      type: 'helper',
      url: 'https://genshin-impact-helper-team.github.io/genshin-builds/en/shogun-raiden/',
    },
  ],
  Razor: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Rosaria: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Sandrone: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/sandrone-quickguide/' },
    { type: 'helper' },
  ],
  SangonomiyaKokomi: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/kokomi/' },
    { type: 'helper' },
  ],
  Sayu: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/sayu-quickguide/' },
    { type: 'helper' },
  ],
  Sethos: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/sethos-quickguide/' },
    { type: 'helper' },
  ],
  Shenhe: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  ShikanoinHeizou: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/heizou/' },
    { type: 'helper' },
  ],
  Sigewinne: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/sigewinne-quickguide/' },
    { type: 'helper' },
  ],
  Skirk: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/skirk-quickguide/' },
    { type: 'helper' },
  ],
  Sucrose: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Tartaglia: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Thoma: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Tighnari: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  TravelerAnemo: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/anemo-traveler/' },
    {
      type: 'helper',
      url: 'https://genshin-impact-helper-team.github.io/genshin-builds/en/anemo-traveler/',
    },
  ],
  TravelerCryo: [
    { type: 'prydwen' },
    {
      type: 'helper',
      url: 'https://genshin-impact-helper-team.github.io/genshin-builds/en/cryo-traveler/',
    },
  ],
  TravelerDendro: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/dendro-traveler-quickguide/' },
    {
      type: 'helper',
      url: 'https://genshin-impact-helper-team.github.io/genshin-builds/en/dendro-traveler/',
    },
  ],
  TravelerElectro: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/electro-traveler/' },
    {
      type: 'helper',
      url: 'https://genshin-impact-helper-team.github.io/genshin-builds/en/electro-traveler/',
    },
  ],
  TravelerGeo: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/geo-traveler/' },
    {
      type: 'helper',
      url: 'https://genshin-impact-helper-team.github.io/genshin-builds/en/geo-traveler/',
    },
  ],
  TravelerHydro: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/hydro-traveler-quickguide/' },
    {
      type: 'helper',
      url: 'https://genshin-impact-helper-team.github.io/genshin-builds/en/hydro-traveler/',
    },
  ],
  TravelerPyro: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/pyro-traveler-quickguide/' },
    {
      type: 'helper',
      url: 'https://genshin-impact-helper-team.github.io/genshin-builds/en/pyro-traveler/',
    },
  ],
  Varesa: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/varesa-quickguide/' },
    { type: 'helper' },
  ],
  Varka: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/varka-quickguide/' },
    { type: 'helper' },
  ],
  Venti: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Vesna: [
    { type: 'prydwen' },
    // No quick guide yet; KQM's infographic (checked 2026-11-05).
    { type: 'kqm', url: 'https://keqingmains.com/i/vesna/' },
    { type: 'helper' },
  ],
  Vodyanitsa: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/vodyanitsa-quickguide/' },
    { type: 'helper' },
  ],
  Wanderer: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Wriothesley: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/wriothesley-quickguide/' },
    { type: 'helper' },
  ],
  Xiangling: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Xianyun: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/xianyun-quickguide/' },
    { type: 'helper' },
  ],
  Xiao: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Xilonen: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/xilonen-quickguide/' },
    { type: 'helper' },
  ],
  Xingqiu: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Xinyan: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  YaeMiko: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/yae/' },
    { type: 'helper' },
  ],
  Yanfei: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Yaoyao: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Yelan: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Yoimiya: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  YumemizukiMizuki: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/mizuki-quickguide/' },
    { type: 'helper' },
  ],
  YunJin: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/yunjin/' },
    { type: 'helper' },
  ],
  Zhongli: [{ type: 'prydwen' }, { type: 'kqm' }, { type: 'helper' }],
  Zibai: [
    { type: 'prydwen' },
    { type: 'kqm', url: 'https://keqingmains.com/q/zibai-quickguide/' },
    { type: 'helper' },
  ],
}

// --- Resolving (pure) ---------------------------------------------------------------

export type SiteType = 'prydwen' | 'kqm' | 'helper'

export interface ResolvedSite {
  type: SiteType
  url: string
  /** False: the site's search or list page (no page for this character). */
  found: boolean
}

export interface ResolvedLink {
  url: string
  title: string
}

export interface ResolvedVideo {
  url: string
  id: string
  title: string
  channel: string
}

export interface CharacterGuides {
  sites: ResolvedSite[]
  links: ResolvedLink[]
  videos: ResolvedVideo[]
}

const SITES: readonly SiteType[] = ['prydwen', 'kqm', 'helper']

const HELPER = 'https://genshin-impact-helper-team.github.io/genshin-builds/'
const SEARCH: Readonly<Record<SiteType, string>> = {
  prydwen: 'https://www.prydwen.gg/genshin-impact/characters',
  kqm: 'https://keqingmains.com/#search',
  helper: HELPER,
}

/** `RaidenShogun` → `raiden-shogun`. */
export function guideSlug(key: string): string {
  return key.replace(/(?<=[a-z0-9])(?=[A-Z])/g, '-').toLowerCase()
}

function defaultUrl(type: SiteType, key: string): string {
  if (type === 'prydwen') return `${SEARCH.prydwen}/${guideSlug(key)}`
  if (type === 'kqm') return `https://keqingmains.com/${guideSlug(key)}/`
  return `${HELPER}en/${guideSlug(key)}/`
}

/** A YouTube video's id from a watch, youtu.be or shorts link; null if none. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^(www|m)\./, '')
    const id =
      host === 'youtu.be'
        ? u.pathname.slice(1)
        : host === 'youtube.com'
          ? (u.searchParams.get('v') ?? u.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1])
          : null
    return id && /^[\w-]{6,}$/.test(id) ? id : null
  } catch {
    return null
  }
}

/** One character's guides: the three sites (always), other links, videos. */
export function guidesFor(
  key: string,
  table: Readonly<Record<string, readonly Guide[]>> = characterGuides,
): CharacterGuides {
  const entries = table[key] ?? []
  const sites = SITES.map((type): ResolvedSite => {
    const entry = entries.find((guide) => guide.type === type)
    if (!entry && type === 'prydwen') return { type, url: defaultUrl(type, key), found: true }
    if (!entry) return { type, url: SEARCH[type], found: false }
    return { type, url: entry.url ?? defaultUrl(type, key), found: true }
  })
  const links = entries.flatMap((guide) =>
    guide.type === 'link' && guide.url ? [{ url: guide.url, title: guide.title ?? guide.url }] : [],
  )
  const videos = entries.flatMap((guide) => {
    if (guide.type !== 'youtube' || !guide.url) return []
    const id = youtubeId(guide.url)
    if (!id) {
      if (import.meta.env?.DEV) console.warn('character-guides: no video id in', guide.url)
      return []
    }
    return [{ url: guide.url, id, title: guide.title ?? '', channel: guide.channel ?? '' }]
  })
  return { sites, links, videos }
}
