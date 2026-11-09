/// <reference types="node" />
/**
 * `node inflate.mjs`: the raw download's script as the zip holds it (this
 * file and inflate.ts bundled by build/script-bundle.ts). Runs in the folder
 * the zip was unpacked to and writes `inflated/` there.
 */

import { inflateAll } from './inflate'

async function main() {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = dirname(fileURLToPath(import.meta.url))
  const done = await inflateAll({
    read: (path) => new Uint8Array(readFileSync(join(root, path))),
    write: (path, bytes) => {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), bytes)
    },
  })
  console.log(
    `Inflated ${done.snapshots} snapshots, ${done.sections} sections and ${done.artifacts} artifacts: ` +
      `${done.bytesIn.toLocaleString()} bytes stored -> ${done.bytesOut.toLocaleString()} bytes of JSON in inflated/`,
  )
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
