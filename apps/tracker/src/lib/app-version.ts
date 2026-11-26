// Baked in by vite.config.ts (`define`); absent under vitest.
declare const __BUILD__: { version: string } | undefined

/** The tracker's version (apps/tracker/package.json), as exports name it. */
export const APP_VERSION: string =
  typeof __BUILD__ === 'object' && __BUILD__ ? __BUILD__.version : 'dev'
