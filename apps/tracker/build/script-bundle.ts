import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'vite'

/**
 * `import script from './file.ts?script'`: the file and everything it imports
 * bundled into one standalone ES module, as a string. The raw download's
 * `inflate.mjs` is made this way, so it carries the site's own decoder and
 * needs no packages, and nothing generated is kept in the repo. Used by the
 * app build and by vitest (the raw-export test reads the zip's script).
 */

const SUFFIX = '?script'
const PREFIX = '\0script:'

const HEADER = `#!/usr/bin/env node
// Teyvat.me raw download: run \`node inflate.mjs\` in this folder (Node 18 or
// newer, no packages needed). Writes readable JSON into inflated/: each
// snapshot as a Leyline file, each stored section decoded, the artifact
// catalog. Formats: README.md beside this file. Made from
// https://github.com/tawan475/teyvat.me-tracker (apps/tracker/src/data/raw-export,
// packages/shared/src/codec).
`

export function scriptBundle(): Plugin {
  const src = fileURLToPath(new URL('../src', import.meta.url))
  return {
    name: 'gdt:script-bundle',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith(SUFFIX)) return null
      const resolved = await this.resolve(source.slice(0, -SUFFIX.length), importer, {
        skipSelf: true,
      })
      return resolved ? PREFIX + resolved.id : null
    },
    async load(id) {
      if (!id.startsWith(PREFIX)) return null
      const entry = id.slice(PREFIX.length)
      const result = await build({
        configFile: false,
        logLevel: 'silent',
        resolve: { alias: { '@': src } },
        build: {
          write: false,
          minify: false,
          target: 'node18',
          lib: { entry, formats: ['es'], fileName: 'script' },
          rollupOptions: { external: [/^node:/] },
        },
      })
      const outputs = Array.isArray(result) ? result : [result]
      const chunks = outputs.flatMap((o) => ('output' in o ? o.output : []))
      const chunk = chunks.find((c) => c.type === 'chunk' && c.isEntry)
      if (!chunk || chunk.type !== 'chunk') throw new Error(`No bundle for ${entry}`)
      if (chunks.filter((c) => c.type === 'chunk').length > 1) {
        throw new Error(`${entry} split into several chunks; a script must be one file`)
      }
      for (const file of chunk.moduleIds) if (!file.startsWith('\0')) this.addWatchFile(file)
      return `export default ${JSON.stringify(HEADER + chunk.code)}`
    },
  }
}
