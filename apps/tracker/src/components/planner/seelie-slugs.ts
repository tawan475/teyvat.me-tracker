/**
 * Seelie's identifiers for the things its export names, for import and
 * export (interop only: identifiers, no game data). Read from seelie.me's
 * public bundle on 2026-10-06 and checked against the planner data by game
 * id (see the tests).
 *
 * - Inventory families (`inventory[]` / `custom_items[]` rows are
 *   `{type, item, tier}`): Seelie's slug for each family or single item,
 *   with the game id of its lowest tier, so a slug maps to the planner's
 *   material exactly. EXP books, ores, Mora and Dream Solvent have fixed rows.
 * - Characters, weapons and artifact sets are slugs of their English names;
 *   the tables list only the ones that aren't (older names, short names).
 * - Main stats and elements as Seelie spells them.
 */

/** Seelie's inventory types with families or items of their own. */
export type SeelieItemType =
  | 'talent'
  | 'wam'
  | 'common'
  | 'common_rare'
  | 'element_1'
  | 'element_2'
  | 'boss'
  | 'local'
  | 'special'

/** Seelie slug -> game id of the family's lowest tier (or the item's own), by type. */
export const SEELIE_ITEMS: Readonly<Record<SeelieItemType, Readonly<Record<string, number>>>> = {
  talent: {
    freedom: 104301,
    resistance: 104304,
    ballad: 104307,
    prosperity: 104310,
    diligence: 104313,
    gold: 104316,
    transience: 104320,
    elegance: 104323,
    light: 104326,
    admonition: 104329,
    ingenuity: 104332,
    praxis: 104335,
    fairness: 104338,
    justice: 104341,
    order: 104344,
    contention: 104347,
    kindling: 104350,
    conflict: 104353,
    moonlight: 104356,
    elysium: 104359,
    vagrancy: 104362,
    charity: 104365,
    fortitude: 104368,
    glory: 104371,
  },
  wam: {
    decarabian: 114001,
    boreal_wolf: 114005,
    dandelion_gladiator: 114009,
    guyun: 114013,
    mist_veiled_elixer: 114017,
    aerosiderite: 114021,
    sea_branch: 114025,
    narukami: 114029,
    mask_w: 114033,
    talisman: 114037,
    oasis_gardens: 114041,
    scorching_might: 114045,
    ancient_chord: 114049,
    dewdrop: 114053,
    pristine_sea: 114057,
    bs_heart: 114061,
    delirious: 114065,
    night_wind: 114069,
    artful_device: 114073,
    flint: 114077,
    far_north_scions: 114081,
    pale_star: 114085,
    spiritual_nectar: 114089,
    frost_emperor: 114093,
  },
  common: {
    slime: 112002,
    mask: 112005,
    scroll: 112008,
    arrowhead: 112011,
    f_insignia: 112032,
    th_insignia: 112035,
    nectar: 112038,
    handguard: 112044,
    spectral_husk: 112053,
    spores: 112059,
    red_satin: 112065,
    transoceanic: 112080,
    gear: 112083,
    n_fang: 112101,
    whistle: 112104,
    drive_shaft: 112122,
    warrant: 112125,
    ethereal: 112146,
    chimeric: 112149,
  },
  common_rare: {
    horn: 112014,
    statuette: 112017,
    ley_line: 112020,
    chaos: 112023,
    mist: 112026,
    sacrificial_knife: 112029,
    bone_shard: 112041,
    chaos_g: 112047,
    prism: 112050,
    claw: 112056,
    fungal_nucleus: 112062,
    chaos_s: 112068,
    d_prism: 112071,
    shell: 112074,
    flower: 112077,
    tainted_water: 112086,
    core: 112089,
    pocket_watch: 112092,
    fin: 112095,
    hilt: 112098,
    will: 112107,
    ignited: 112110,
    secret_source: 112113,
    bud: 112116,
    shellshard: 112119,
    frostnight: 112128,
    l_bone: 112131,
    mistshroud: 112134,
    deep_shadow: 112137,
    flaming_hilt: 112140,
    lunar_iron: 112143,
    accreted: 112152,
    life: 112155,
    // 7.2 (Snowborn Heartshard); Seelie's bundle confirmed it on 2026-11-07.
    snowborn: 112158,
  },
  element_1: {
    brilliant_diamond: 104101,
    agnidus_agate: 104111,
    varunada_lazurite: 104121,
    nagadus_emerald: 104131,
    vajrada_amethyst: 104141,
    vayuda_turqoise: 104151,
    shivada_jade: 104161,
    prithiva_topaz: 104171,
  },
  element_2: {
    hurricane_seed: 113001,
    lightning_prism: 113002,
    basalt_pillar: 113009,
    hoarfrost_core: 113010,
    everflame_seed: 113011,
    cleansing_heart: 113012,
    juvenile_jade: 113016,
    crystalline_bloom: 113020,
    maguu_kishin: 113022,
    perpetual_heart: 113023,
    smoldering_pearl: 113024,
    dew_of_repudiation: 113028,
    storm_beads: 113029,
    riftborn_regalia: 113030,
    dragonheirs_false_fin: 113031,
    runic_fang: 113035,
    majestic_hooked_beak: 113036,
    thunderclap_fruitcore: 113037,
    perpetual_caliber: 113038,
    light_guiding_tetrahedron: 113039,
    quelled_creeper: 113040,
    pseudo_stamens: 113044,
    evergloom_ring: 113045,
    clockwork_component_coppelia: 113049,
    clockwork_component_coppelius: 113050,
    emperors_resolution: 113051,
    tourbillon_device: 113052,
    fontemer_unihorn: 113053,
    water_that_failed: 113057,
    cloudseam_scale: 113058,
    golden_melody: 113059,
    binding_blessing: 113064,
    flamegranate: 113065,
    secret_source_core: 113066,
    ensnaring_gaze: 113067,
    talisman_of_the_enigmatic_land: 113071,
    sparkless_statue_core: 113072,
    airflow_accumulator: 113076,
    precision_kuuvahki: 113077,
    lightbearing_scale_feather: 113078,
    radiant_antler: 113079,
    kuuvahki_core: 113080,
    remnant_of_the_dreadwing: 113084,
    prismatic_severed_tail: 113085,
    plume_of_the_fallen_watcher: 113086,
    unscorched_blossom_branch: 113090,
    severed_tail_of_the_sky_roamer: 113091,
    cracked_armor: 113092,
    // 7.2, spelled from the name until Seelie's bundle shows its own slug.
    shattered_stability_anchor: 113093,
  },
  boss: {
    dvalins_plume: 113003,
    dvalins_claw: 113004,
    dvalins_sigh: 113005,
    tail_of_boreas: 113006,
    ring_of_boreas: 113007,
    spirit_locket_of_boreas: 113008,
    tusk_of_monoceros_caeli: 113013,
    shard_of_a_foul_legacy: 113014,
    shadow_of_the_warrior: 113015,
    dragon_lords_crown: 113017,
    bloodjade_branch: 113018,
    gilded_scale: 113019,
    signora_flower: 113025,
    signora_wings: 113026,
    signora_heart: 113027,
    mudra_of_the_malefic_general: 113032,
    tears_of_the_calamitous_god: 113033,
    the_meaning_of_aeons: 113034,
    puppet_strings: 113041,
    mirror_of_mushin: 113042,
    dakas_bell: 113043,
    worldspan_fern: 113046,
    primordial_greenbloom: 113047,
    everamber: 113048,
    lightless_silk_string: 113054,
    lightless_eye_of_the_maelstrom: 113055,
    lightless_mass: 113056,
    fading_candle: 113060,
    silken_feather: 113061,
    denial_and_judgment: 113062,
    cornerstone: 113063,
    eroded_horn: 113068,
    eroded_sunfire: 113069,
    eroded_scale: 113070,
    ascended_sample_knight: 113073,
    ascended_sample_rook: 113074,
    ascended_sample_queen: 113075,
    doctor_mask: 113081,
    doctor_madman: 113082,
    doctor_elixir: 113083,
    counterfeit_resin: 113087,
    withered_branch: 113088,
    profaned_sprout: 113089,
  },
  local: {
    wolfhook: 100021,
    valberry: 100022,
    cecilia: 100023,
    windwheel_aster: 100024,
    philanemo_mushroom: 100025,
    jueyun_chili: 100027,
    noctilucous_jade: 100028,
    silk_flower: 100029,
    glaze_lilly: 100030,
    qingxin: 100031,
    starconch: 100033,
    violetgrass: 100034,
    small_lamp_grass: 100055,
    calla_lily: 100056,
    dandelion_seed: 100057,
    cor_lapis: 100058,
    onikabuto: 101201,
    sakura_bloom: 101202,
    crystal_marrow: 101203,
    dendrobium: 101204,
    naku_weed: 101205,
    sea_ganoderma: 101206,
    sango_pearl: 101207,
    tenkumo_fruit: 101208,
    fluorescent_fungus: 101209,
    rukkhashava: 101213,
    padisarah: 101214,
    nilotpala: 101215,
    kalpalata: 101217,
    redcrest: 101220,
    sand_grease_pupa: 101222,
    mourning_flower: 101223,
    trishiraite: 101224,
    scarab: 101225,
    beryl_conch: 101232,
    romaritime_flower: 101233,
    lumidouce_bell: 101235,
    rainbow_rose: 101236,
    lumitoile: 101237,
    lakelight_lily: 101238,
    subdetection_unit: 101239,
    first_dewdrop: 101240,
    clearwater_jade: 101241,
    sprayfeather: 101247,
    chrysanthemum: 101248,
    quenepa: 101249,
    saurian_succulent: 101250,
    hornshroom: 101252,
    purpurbloom: 101253,
    skysplit_gembloom: 101254,
    dracolite: 101255,
    portable_bearing: 101257,
    frostlamp_flower: 101261,
    moonfall_silver: 101263,
    winter_icelea: 101268,
    pine_amber: 101269,
    etherwing_moth: 101272,
    frostfairy: 101275,
    flockingweed: 101276,
    golden_fern: 101277,
    // 7.2's planner locals (7.1 items), spelled from the names until Seelie's bundle shows its own.
    fairy_wormwood: 101273,
    kristallfold: 101274,
  },
  special: {
    crown: 104319,
  },
}

/** Seelie's rows (type, item) for EXP, ores, Mora and Dream Solvent by GOOD key; tier 0. */
export const SEELIE_FIXED_ITEMS: Readonly<Record<string, readonly [string, string]>> = {
  Mora: ['mora', 'mora'],
  HerosWit: ['xp', 'xp'],
  AdventurersExperience: ['xp', 'xp_sub_1'],
  WanderersAdvice: ['xp', 'xp_sub_0'],
  MysticEnhancementOre: ['wep_xp', 'wep_xp'],
  FineEnhancementOre: ['wep_xp', 'wep_xp_sub_1'],
  EnhancementOre: ['wep_xp', 'wep_xp_sub_0'],
  DreamSolvent: ['special', 'dream_solvent'],
}

/** Characters whose Seelie slug isn't their GOOD key in lower case (GOOD key -> slug). */
export const SEELIE_CHARACTER_SLUGS: Readonly<Record<string, string>> = {
  KaedeharaKazuha: 'kazuha',
  KamisatoAyaka: 'ayaka',
  RaidenShogun: 'shogun',
  KujouSara: 'sara',
  SangonomiyaKokomi: 'kokomi',
  AratakiItto: 'itto',
  KamisatoAyato: 'ayato',
  KukiShinobu: 'shinobu',
  ShikanoinHeizou: 'heizou',
  YumemizukiMizuki: 'mizuki',
}

/** Weapons whose Seelie slug isn't the snake case of their GOOD key (GOOD key -> slug). */
export const SEELIE_WEAPON_SLUGS: Readonly<Record<string, string>> = {
  FleuveCendreFerryman: 'crossing_of_fleuve_cendre',
  Hamayumi: 'demon_slayer_bow',
  PolarStar: 'brumal_star',
  EndOfTheLine: 'trawler',
  BlackcliffAgate: 'blackcliff_amulet',
  EverlastingMoonglow: 'fumetsu_gekka',
  PrototypeAmber: 'prototype_malice',
  HakushinRing: 'white_dragon_ring',
  KatsuragikiriNagamasa: 'katsuragis_slasher',
  PrototypeArchaic: 'prototype_aminus',
  SnowTombedStarsilver: 'snow_tombed_starsliver',
  EngulfingLightning: 'grasscutters_light',
  PrototypeStarglitter: 'prototype_grudge',
  AmenomaKageuchi: 'amenoma_kageuta_blade',
  KagotsurubeIsshin: 'cursed_blade',
  MistsplitterReforged: 'mistsplitters_reflection',
  FreedomSworn: 'freedom-sworn',
}

/** Artifact sets whose Seelie slug isn't the snake case of their GOOD key (GOOD key -> slug). */
export const SEELIE_ARTIFACT_SLUGS: Readonly<Record<string, string>> = {
  DisenchantmentInDeepShadow: 'disenchantment',
  ADayCarvedFromRisingWinds: 'day_carved',
  AubadeOfMorningstarAndMoon: 'aubade',
  SilkenMoonsSerenade: 'silken_moon',
  NightOfTheSkysUnveiling: 'night_of_the_sky',
  ScrollOfTheHeroOfCinderCity: 'scroll_of_the_hero',
  ShimenawasReminiscence: 'reminiscence_of_shime',
  EmblemOfSeveredFate: 'seal_of_insulation',
  NighttimeWhispersInTheEchoingWoods: 'nighttime_whispers',
  LongNightsOath: 'long_night',
  FinaleOfTheDeepGalleries: 'deep_galleries',
}

/** Seelie's main stats (artifact goals) -> GOOD stat keys. */
export const SEELIE_STATS: Readonly<Record<string, readonly string[]>> = {
  hp_p: ['hp_'],
  def_p: ['def_'],
  atk_p: ['atk_'],
  elemental_mastery: ['eleMas'],
  energy_recharge_p: ['enerRech_'],
  physical_dmg: ['physical_dmg_'],
  pyro_dmg: ['pyro_dmg_'],
  electro_dmg: ['electro_dmg_'],
  hydro_dmg: ['hydro_dmg_'],
  cryo_dmg: ['cryo_dmg_'],
  anemo_dmg: ['anemo_dmg_'],
  geo_dmg: ['geo_dmg_'],
  dendro_dmg: ['dendro_dmg_'],
  crit_rate_p: ['critRate_'],
  crit_dmg_p: ['critDMG_'],
  crit_rate_dmg_p: ['critRate_', 'critDMG_'],
  healing_bonus: ['heal_'],
}

/** Seelie's gem family slug for each element (its custom characters carry both). */
export const SEELIE_ELEMENT_GEMS: Readonly<Record<string, string>> = {
  pyro: 'agnidus_agate',
  hydro: 'varunada_lazurite',
  electro: 'vajrada_amethyst',
  cryo: 'shivada_jade',
  anemo: 'vayuda_turqoise',
  geo: 'prithiva_topaz',
  dendro: 'nagadus_emerald',
}

/** "SnowTombedStarsilver" -> "snow_tombed_starsilver" (words split before capitals and digits). */
export const snakeCase = (key: string) =>
  key
    .split(/(?=[A-Z])|(?<=[a-z])(?=[0-9])/)
    .map((w) => w.toLowerCase())
    .join('_')

/** Lower-case letters and digits only (how slugs compare). */
export const slugLetters = (slug: string) => slug.toLowerCase().replace(/[^a-z0-9]/g, '')

const invert = (table: Readonly<Record<string, string>>) =>
  Object.fromEntries(Object.entries(table).map(([key, slug]) => [slugLetters(slug), key]))

/** Seelie weapon slug (letters only) -> GOOD key, for the slugs above. */
export const SEELIE_WEAPON_KEYS: Readonly<Record<string, string>> = invert(SEELIE_WEAPON_SLUGS)
/** Seelie artifact slug (letters only) -> GOOD key, for the slugs above. */
export const SEELIE_ARTIFACT_KEYS: Readonly<Record<string, string>> = invert(SEELIE_ARTIFACT_SLUGS)

/** A character's Seelie slug ("hutao", "shogun", "traveler_anemo"). */
export function seelieCharacterSlug(key: string): string {
  const alias = SEELIE_CHARACTER_SLUGS[key]
  if (alias) return alias
  const traveler = /^Traveler([A-Z][a-z]+)$/.exec(key)
  if (traveler) return `traveler_${traveler[1]!.toLowerCase()}`
  return slugLetters(key)
}

/** A weapon's Seelie slug ("staff_of_homa", "grasscutters_light"). */
export const seelieWeaponSlug = (key: string) => SEELIE_WEAPON_SLUGS[key] ?? snakeCase(key)

/** An artifact set's Seelie slug ("gladiators_finale", "seal_of_insulation"). */
export const seelieArtifactSlug = (key: string) => SEELIE_ARTIFACT_SLUGS[key] ?? snakeCase(key)

/**
 * The GOOD set key of a Seelie artifact slug among `sets`: an alias, the
 * same letters, then the one set whose name holds every word of the slug
 * ("long_night" is Long Night's Oath). Null when none or several do.
 */
export function artifactSetOfSlug(slug: string, sets: readonly string[]): string | null {
  const letters = slugLetters(slug)
  if (!letters) return null
  const alias = SEELIE_ARTIFACT_KEYS[letters]
  if (alias && sets.includes(alias)) return alias
  const exact = sets.find((key) => slugLetters(key) === letters)
  if (exact) return exact
  const words = slug
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3)
  if (words.length === 0) return null
  const found = sets.filter((key) => words.every((w) => key.toLowerCase().includes(w)))
  return found.length === 1 ? found[0]! : null
}

/** Seelie's stat for GOOD main stats: both crit stats are "crit rate or damage", else the first Seelie has. */
export function seelieStat(stats: readonly string[] | undefined): string | null {
  if (!stats?.length) return null
  if (stats.includes('critRate_') && stats.includes('critDMG_')) return 'crit_rate_dmg_p'
  for (const stat of stats) {
    const found = Object.entries(SEELIE_STATS).find(
      ([, keys]) => keys.length === 1 && keys[0] === stat,
    )
    if (found) return found[0]
  }
  return null
}
