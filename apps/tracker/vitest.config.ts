import { fileURLToPath } from 'node:url'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'
import { scriptBundle } from './build/script-bundle.ts'

// Worker tests run inside workerd against a local D1, with the real migrations
// applied before each test file (see worker/test/setup.ts). The app's pure
// helpers (src/**/__tests__) run there too, in en-US and the machine's time zone
// (UTC on CI): a test of local time builds what it expects with the Date constructor.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(fileURLToPath(new URL('./migrations', import.meta.url)))
  const liveMigrations = await readD1Migrations(
    fileURLToPath(new URL('./migrations-live', import.meta.url)),
  )
  return {
    plugins: [
      scriptBundle(),
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            TEST_LIVE_MIGRATIONS: liveMigrations,
            JWT_SECRET: 'test-jwt-secret-test-jwt-secret-0123456789',
            PASSWORD_PEPPER: 'test-pepper-test-pepper-test-pepper-0123',
            DIAG_KEY: 'test-diag-key-test-diag-key-test-diag-key',
            // The human check is off (as in production until both are set),
            // whatever .dev.vars says; its tests turn it on per request.
            TURNSTILE_SITE_KEY: '',
            TURNSTILE_SECRET_KEY: '',
            // A throwaway VAPID pair: alerts on in tests (docs/plans/capture-link.md).
            VAPID_PUBLIC_KEY:
              'BPkVtt1GqmmrFtIV1eQhyn5k7HlnDScIkDMkPcTE6N4LJcfLyB2ziqduAlcrZjqGqyNz9wHEAUhB_EIvanrKhT0',
            VAPID_PRIVATE_KEY: 'X6BjtZOdxUO89h7YnqdkocKiyK81WrKLe2QkZzlx8LA',
          },
        },
      }),
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    test: {
      include: ['worker/**/*.test.ts', 'src/**/__tests__/*.test.ts'],
      setupFiles: ['./worker/test/setup.ts'],
      // Many worker tests sign users up and in, and each password hash is
      // ~200 ms of Argon2id: on a busy machine a test of several logins and
      // imports passed alone but crossed the 5 s default in a full run.
      testTimeout: 20_000,
    },
  }
})
