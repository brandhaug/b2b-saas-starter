import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { fixtureSession } from '@/test/fixture-session'
import { requestWorkspaceExportHandler } from './workspace-exports.effects'
import type * as AuthModule from './auth'

/**
 * The export request through its handler, against the Seed layer (the inert
 * `cloudflare:workers` shim under Vitest): `usr_demo` owns `starter-lab`,
 * `usr_ops` is its admin, `usr_dev` a plain member — the statement is
 * owner-only. Plain `it`: `@effect/vitest`'s TestClock would date the
 * export in 1970.
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))

vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireRequestSession: async () => fixtureSession(actor)
}))

describe('requestWorkspaceExportHandler', () => {
  beforeEach(() => {
    actor.userId = 'usr_demo'
  })

  it('lets an owner request an export', async () => {
    const requested = await requestWorkspaceExportHandler({
      workspaceSlug: 'starter-lab'
    })
    expect(requested.status).toBe('ready')
  })

  it('refuses an admin — the statement is owner-only', async () => {
    actor.userId = 'usr_ops'
    await expect(
      requestWorkspaceExportHandler({ workspaceSlug: 'starter-lab' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('refuses a member', async () => {
    actor.userId = 'usr_dev'
    await expect(
      requestWorkspaceExportHandler({ workspaceSlug: 'starter-lab' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })
})
