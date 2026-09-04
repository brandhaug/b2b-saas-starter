import { SeedLayer } from '@b2b-saas-starter/capabilities/layers'
import {
  demoMemberIdentity,
  demoUserIdentity,
  seedWorkspaceRecord
} from '@b2b-saas-starter/capabilities/seed-fixture'
import {
  testWorkspaceContext,
  type Actor
} from '@b2b-saas-starter/capabilities/workspace-context'
import { describe, expect, it } from 'vite-plus/test'
import { Effect, Exit, Layer } from 'effect'

import { requestWorkspaceExport } from './workspace-exports'

/**
 * The effect below the session gate, driven against the Seed layer with the
 * role under test injected — the same seam `invitations.test.ts` uses. Plain
 * `it` + `Effect.runPromise`: `@effect/vitest`'s TestClock would date the
 * export in 1970.
 */
function runAs(actor: Actor) {
  return Effect.runPromiseExit(
    Effect.scoped(
      requestWorkspaceExport().pipe(
        Effect.provide(
          Layer.merge(SeedLayer, testWorkspaceContext(seedWorkspaceRecord, actor))
        )
      )
    )
  )
}

describe('requestWorkspaceExport', () => {
  it('lets an owner request an export', async () => {
    const exit = await runAs({
      userId: demoUserIdentity.id,
      role: 'owner',
      systemRole: 'admin'
    })
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value.status).toBe('ready')
    }
  })

  it('refuses an admin — the statement is owner-only', async () => {
    const exit = await runAs({ userId: 'usr_ops', role: 'admin', systemRole: 'user' })
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('refuses a member', async () => {
    const exit = await runAs({
      userId: demoMemberIdentity.id,
      role: 'member',
      systemRole: 'user'
    })
    expect(Exit.isFailure(exit)).toBe(true)
  })
})
