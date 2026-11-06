/**
 * The loading look of every image on the site (the user's ask, 2026-11-06):
 * an <img> breathes on the skeleton colour (main.css `img:not([data-loaded])`,
 * one animated SVG background, nothing per image)
 * until it has loaded or failed, when this marks it `data-loaded`. One
 * capture listener on the document for the whole app, nothing per image.
 * `data-skeleton="off"` on an <img> opts it out: backdrop art, decorative
 * emblems, and cut-out art laid on the game's own ground (an icon on a bag
 * cell or a rarity band, a side portrait over the Equipped bar), where that
 * ground is the placeholder: a grey box over it read as broken (the user,
 * 2026-11-07), and a side portrait's box is larger than the art it shows.
 */
export function watchImageLoading(root: Document = document): void {
  const mark = (event: Event) => {
    const target = event.target
    if (target instanceof HTMLImageElement) target.dataset.loaded = ''
  }
  // load and error do not bubble: the capture phase sees every image's.
  root.addEventListener('load', mark, true)
  root.addEventListener('error', mark, true)
  // Images done before this ran (none in practice: the app mounts after).
  for (const img of root.images) if (img.complete) img.dataset.loaded = ''
}
