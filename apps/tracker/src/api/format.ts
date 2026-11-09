/**
 * The bundle layout this app reads (`?format=`; see @gdt/shared codec/bundle.ts).
 * Bundles are cached by ETag per layout, so raising it never revalidates an
 * older body into use. Its own module so the export worker can import it.
 */
export const BUNDLE_FORMAT = 3
