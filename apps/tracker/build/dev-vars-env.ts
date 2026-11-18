/**
 * Puts .dev.vars' pairs over `env` and turns wrangler's process.env reading on
 * (CLOUDFLARE_INCLUDE_PROCESS_ENV); the names it set. For `vite preview`
 * (preview-dev-vars.ts); pure, so the tests can run it.
 */
export function applyDevVars(
  pairs: Record<string, string | undefined>,
  env: Record<string, string | undefined>,
): string[] {
  const names: string[] = []
  for (const [name, value] of Object.entries(pairs)) {
    if (value === undefined) continue
    env[name] = value
    names.push(name)
  }
  env.CLOUDFLARE_INCLUDE_PROCESS_ENV = 'true'
  return names
}
