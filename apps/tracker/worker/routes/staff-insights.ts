/**
 * The staff Insights page's API, mounted at /api/staff/insights by
 * routes/staff.ts (so `requireActiveSession` + `requireStaff` run first).
 * Every route needs `site.metrics`, the Metrics page's node (404 without
 * it). Totals and shares only, so nothing is logged: no user is named. All
 * reads, each kept ten minutes (services/insights.ts).
 */

import {
  COUNTRY_BASES,
  type CountryBasis,
  type StaffFeatureInsights,
  type StaffPeopleInsights,
  type StaffRetentionInsights,
  type StaffUploadInsights,
} from '@gdt/shared'
import { Hono } from 'hono'
import type { AppEnv } from '../env'
import { need } from '../lib/staff'
import {
  featureInsights,
  peopleInsights,
  retentionInsights,
  uploadInsights,
} from '../services/insights'

export const staffInsights = new Hono<AppEnv>()
  .use(need('site.metrics'))

  .get('/people', async (c) => {
    const asked = c.req.query('basis')
    const basis = (COUNTRY_BASES as readonly string[]).includes(asked ?? '')
      ? (asked as CountryBasis)
      : 'signup'
    return c.json<StaffPeopleInsights>(await peopleInsights(c.env, basis))
  })

  .get('/retention', async (c) => c.json<StaffRetentionInsights>(await retentionInsights(c.env)))

  .get('/features', async (c) => c.json<StaffFeatureInsights>(await featureInsights(c.env)))

  .get('/uploads', async (c) => c.json<StaffUploadInsights>(await uploadInsights(c.env)))
