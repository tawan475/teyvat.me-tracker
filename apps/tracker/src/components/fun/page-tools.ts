/**
 * A Fun page's own controls in the title row (the wheel's list name, My lists,
 * Share link): both views around the pages (views/account/FunView.vue,
 * views/FunPublicView.vue) put an element with this id right of the title,
 * wrapping under it on narrow screens, and a page teleports into it.
 */
export const FUN_TOOLS_ID = 'fun-page-tools'
export const FUN_TOOLS_TARGET = `#${FUN_TOOLS_ID}`
