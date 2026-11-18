import { describe, expect, it } from 'vitest'
import { applyDevVars } from '../../../build/dev-vars-env'

describe('`vite preview` and .dev.vars', () => {
  it("puts the file's pairs over the environment and turns wrangler's reading on", () => {
    const env: Record<string, string | undefined> = { JWT_SECRET: 'from-the-shell', PATH: '/bin' }
    const names = applyDevVars({ JWT_SECRET: 'from-dev-vars', DIAG_KEY: 'diag' }, env)
    expect(names).toEqual(['JWT_SECRET', 'DIAG_KEY'])
    expect(env).toEqual({
      JWT_SECRET: 'from-dev-vars',
      DIAG_KEY: 'diag',
      PATH: '/bin',
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
    })
  })

  it('sets nothing for a pair without a value', () => {
    const env: Record<string, string | undefined> = {}
    expect(applyDevVars({ DIAG_KEY: undefined }, env)).toEqual([])
    expect(env.DIAG_KEY).toBeUndefined()
  })
})
