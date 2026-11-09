#!/usr/bin/env node
// Teyvat.me raw download: inflates every stored section and catalog chunk in
// this folder. Node 18 or newer, no packages needed:
//
//   node inflate.mjs
//
// Writes inflated/sections/<id>.json (JSON sections) or .bin (binary
// sections) and inflated/catalog/<first>-<last>.bin, and prints what it did.
// Formats: README.md beside this file.

/** Section blob format byte: high nibble = layout, low nibble = compression. */
const LAYOUT_JSON = 0x00
const COMPRESSION = { STORED: 0, DEFLATED: 1, DEFLATED_WITH_BASE: 2 }
/** Catalog chunk format byte. */
const CHUNK = { STORED: 1, DEFLATED: 2 }

/**
 * Inflates everything the zip holds. `io.read(path)` gives a file's bytes,
 * `io.write(path, bytes)` writes one; `inflateRaw(bytes, dictionary?)` is raw
 * DEFLATE (zlib's inflateRaw, with `dictionary` as its preset dictionary).
 * Returns what was written.
 */
export function inflateAll(io, inflateRaw) {
  const text = (path) => new TextDecoder().decode(io.read(path))
  const sections = JSON.parse(text('sections.json'))
  const byId = new Map(sections.map((s) => [s.id, s]))
  const payloads = new Map()
  const done = { sections: 0, catalog: 0, bytesIn: 0, bytesOut: 0 }

  // A section's payload: its layout byte, then the inflated body. A blob
  // compressed against its base uses the base's payload as the dictionary.
  const payload = (id, depth = 0) => {
    const known = payloads.get(id)
    if (known) return known
    if (depth > 4) throw new Error(`Section ${id}: its bases go too deep`)
    const entry = byId.get(id)
    if (!entry) throw new Error(`Section ${id} is not in sections.json`)
    const blob = io.read(entry.file)
    if (blob.length === 0) throw new Error(`Section ${id} is empty`)
    const layout = blob[0] & 0xf0
    const compression = blob[0] & 0x0f
    const body = blob.subarray(1)
    let raw
    if (compression === COMPRESSION.STORED) raw = body
    else if (compression === COMPRESSION.DEFLATED) raw = inflateRaw(body)
    else if (compression === COMPRESSION.DEFLATED_WITH_BASE) {
      if (entry.base === null) throw new Error(`Section ${id} needs a base it does not name`)
      raw = inflateRaw(body, payload(entry.base, depth + 1))
    } else {
      throw new Error(
        `Section ${id}: compression ${compression} is newer than this script; download a fresh raw export`,
      )
    }
    const out = new Uint8Array(raw.length + 1)
    out[0] = layout
    out.set(raw, 1)
    payloads.set(id, out)
    return out
  }

  for (const entry of sections) {
    const p = payload(entry.id)
    const json = (p[0] & 0xf0) === LAYOUT_JSON
    const body = p.subarray(1)
    io.write(`inflated/sections/${entry.id}.${json ? 'json' : 'bin'}`, body)
    done.sections++
    done.bytesIn += entry.bytes
    done.bytesOut += body.length
  }

  const catalog = JSON.parse(text('catalog.json'))
  for (const chunk of catalog.chunks) {
    const data = io.read(chunk.file)
    let body
    if (data[0] === CHUNK.STORED) body = data.subarray(1)
    else if (data[0] === CHUNK.DEFLATED) body = inflateRaw(data.subarray(1))
    else throw new Error(`Catalog chunk ${chunk.file}: format ${data[0]} is newer than this script`)
    io.write(`inflated/catalog/${chunk.first}-${chunk.last}.bin`, body)
    done.catalog++
    done.bytesIn += data.length
    done.bytesOut += body.length
  }
  return done
}

async function main() {
  const { readFileSync, writeFileSync, mkdirSync } = await import('node:fs')
  const { dirname, join } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { inflateRawSync } = await import('node:zlib')
  const root = dirname(fileURLToPath(import.meta.url))
  const done = inflateAll(
    {
      read: (path) => new Uint8Array(readFileSync(join(root, path))),
      write: (path, bytes) => {
        mkdirSync(dirname(join(root, path)), { recursive: true })
        writeFileSync(join(root, path), bytes)
      },
    },
    (bytes, dictionary) =>
      new Uint8Array(inflateRawSync(bytes, dictionary ? { dictionary } : undefined)),
  )
  console.log(
    `Inflated ${done.sections} sections and ${done.catalog} catalog chunks: ` +
      `${done.bytesIn.toLocaleString()} bytes stored -> ${done.bytesOut.toLocaleString()} bytes, in inflated/`,
  )
}

// Runs when started as `node inflate.mjs` (not when a test imports it).
const started = typeof process !== 'undefined' && Array.isArray(process.argv) ? process.argv[1] : ''
const startedName = started ? started.split(/[\\/]/).pop() : ''
if (startedName && decodeURIComponent(import.meta.url).endsWith(`/${startedName}`)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
