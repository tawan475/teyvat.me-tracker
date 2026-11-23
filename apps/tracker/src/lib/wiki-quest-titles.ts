/**
 * Quests whose wiki page isn't titled with the quest's name: the name is
 * taken by something else (Yelan's C6 is "Winner Takes All", so the quest is
 * "Winner Takes All (Quest)"), the quest is split into parts, or the wiki
 * spells it differently. English quest name → wiki page title.
 *
 * Found on 2026-11-24 by asking the wiki's API, for every World Quest and
 * Archive quest name, whether "<name> (Quest)" exists, which names are
 * disambiguation pages and which are missing. Recheck after a patch adds
 * quests (a new name that clashes opens the other page until it is listed).
 * Names left out on purpose: "Awaken the Residual Pari in the Fravashi
 * Trees" (one page per tree) and "Afterword" (three events' quests) keep
 * their disambiguation page.
 */
export const WIKI_QUEST_TITLES: Readonly<Record<string, string>> = {
  // World Quests: the name is another page.
  'Swords and Secrets': 'Swords and Secrets (Quest)',
  'Lost in a Foreign Land': 'Lost in a Foreign Land (Quest)',
  "Valor's Afterglow": "Valor's Afterglow (Quest)",
  'Tatara Tales': 'Tatara Tales (Quest)',
  "Hyperion's Dirge": "Hyperion's Dirge (Quest)",
  'Woodland Encounter': 'Woodland Encounter (Quest)',
  'Varuna Gatha': 'Varuna Gatha (Quest)',
  'Adventure Takes Courage!': 'Adventure Takes Courage! (Quest)',
  'An Unwavering Culinary Dream': 'An Unwavering Culinary Dream (Quest)',
  'Monumental Study': 'Monumental Study (Quest)',
  'Pale Fire': 'Pale Fire (Quest)',
  'Foggy Forest Path': 'Foggy Forest Path (Quest)',
  'Search in the Algae Sea': 'Search in the Algae Sea (Quest)',
  "Savior's Wake": "Savior's Wake (Quest)",
  "Rowboat's Wake": "Rowboat's Wake (Quest)",
  'Waking from the Great Dream': 'Waking from the Great Dream (Quest)',
  'Stand by Me': 'Stand by Me (Quest)',
  "The Chosen One's Promise": "The Chosen One's Promise (Quest)",
  "Witch's Lodge": "Witch's Lodge (Quest)",
  'Variations on Belyi and Chernyi': 'Variations on Belyi and Chernyi (Quest)',
  'Upstream Variations': 'Upstream Variations (Quest)',
  'Winner Takes All': 'Winner Takes All (Quest)',
  // World Quests in parts: the first part.
  'Treasure Lost, Treasure Found': 'Treasure Lost, Treasure Found (Part 1)',
  'An Artist Adrift': 'An Artist Adrift (Part 1)',
  'The Hymn of Tir Yazad': 'The Hymn of Tir Yazad (Part 1)',
  'Strange Stone Chronicle': 'Strange Stone Chronicle (Part 1)',
  Pursuit: 'Pursuit (Part 1)',
  'The Flowing Primal Flame': 'The Flowing Primal Flame (Part 1)',
  // Spelled otherwise on the wiki.
  'Like a Land Where the Tide’s Song Whispers': "Like a Land Where the Tide's Song Whispers",
  'All Names Are Noble': 'All Names are Noble',
  // Archive quests: the name is another page.
  'Abyss Mage': 'Abyss Mage (Quest)',
  'Knights of Favonius': 'Knights of Favonius (Quest)',
  'Troublesome Work': 'Troublesome Work (Quest)',
  'Let the Wind Lead': 'Let the Wind Lead (Quest)',
  Guizhong: 'Guizhong (Quest)',
  'When the West Wind Arises': 'When the West Wind Arises (Quest)',
  "Master's Day Off": "Master's Day Off (Quest)",
  'Should You Be Trapped in a Windless Land': 'Should You Be Trapped in a Windless Land (Quest)',
  "Darknight Hero's Alibi": "Darknight Hero's Alibi (Quest)",
  'The Crux Clash': 'The Crux Clash (Quest)',
  Wishes: 'Wishes (Quest)',
  'End of the Line': 'End of the Line (Quest)',
  'Fortress of Meropide': 'Fortress of Meropide (Quest)',
  'Pilgrimage of the Return of the Sacred Flame':
    'Pilgrimage of the Return of the Sacred Flame (Quest)',
  "Kinich's Deal": "Kinich's Deal (Quest)",
  'Truth Amongst the Pages of Purana': 'Truth Amongst the Pages of Purana (Quest)',
  "Wraith's Nocturne": "Wraith's Nocturne (Quest)",
  'Should We Meet Again': 'Should We Meet Again (Quest)',
  'Those We Have Lost': 'Those We Have Lost (Quest)',
  'Those We Have Kept': 'Those We Have Kept (Quest)',
  'Nature and Wisdom': 'Nature and Wisdom (Quest)',
  'A Decision': 'A Decision (Archon Quest)',
}
