import type { Plugin } from 'vite'

/**
 * The Cloudflare plugin writes the local secrets (.dev.vars, .env) next to the
 * built Worker, for `vite preview`. A build never keeps them: whatever runs
 * dist/ (wrangler, a self-host's container) would read a developer's secrets
 * from there (self-host/README.md).
 */
export function noDevVars(): Plugin {
  return {
    name: 'no-dev-vars',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/(^|\/)\.dev\.vars(\..*)?$/.test(name)) delete bundle[name]
      }
    },
  }
}
