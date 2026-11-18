import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import type { Plugin } from 'vite'
import { applyDevVars } from './dev-vars-env.ts'

/**
 * `vite preview` only: the local secrets for the built Worker.
 *
 * The Cloudflare plugin writes .dev.vars next to the built Worker and its
 * preview reads it there; a build no longer keeps that copy (no-dev-vars.ts:
 * whatever runs dist/ would read a developer's secrets). So the preview reads
 * apps/tracker/.dev.vars itself and hands its pairs to wrangler through this
 * process's environment: with CLOUDFLARE_INCLUDE_PROCESS_ENV wrangler binds
 * the environment as the local Worker's secrets when it finds no .dev.vars
 * beside the built config. dist/ stays free of them.
 *
 * The preview's Worker therefore sees this shell's environment too (a
 * variable named like a Worker setting applies, as it would from .dev.vars).
 * Without a .dev.vars nothing changes.
 */
export function previewDevVars(file: string): Plugin {
  return {
    name: 'preview-dev-vars',
    config(_, { isPreview }) {
      if (isPreview) readDevVars(file)
    },
  }
}

/** Reads the .dev.vars at `file`, if there is one, into `env`; the names it set. */
export function readDevVars(file: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!existsSync(file)) return []
  return applyDevVars(parseEnv(readFileSync(file, 'utf8')), env)
}
