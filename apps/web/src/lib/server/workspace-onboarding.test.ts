import { SeedAuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { SeedWorkspaceOnboarding } from '@b2b-saas-starter/capabilities/governance/workspace-onboarding'
import {
  type Workspace,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import {
  testWorkspaceContext,
  type Actor
} from '@b2b-saas-starter/capabilities/workspace-context'
import { describe, expect, it } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import { loadWorkspaceDashboard } from './workspace-dashboard'
import { dismissOnboardingChecklist } from './workspace-onboarding'

/**
 * Dismissal below its session gate: the `onboarding:dismiss` permission is the
 * whole behaviour worth testing here, so each role gets a case. Real clock on
 * purpose (plain `it` + `Effect.runPromise`, not `@effect/vitest`'s TestClock).
 */

const workspace: Workspace = {
  id: 'wrk_test',
  slug: 'test-lab',
  name: 'Test Lab',
  planId: 'starter'
}

function actor(role: WorkspaceRole): Actor {
  return { userId: `usr_${role}`, role, systemRole: 'user' }
}

function layerFor(who: Actor | null) {
  return Layer.mergeAll(
    SeedWorkspaceOnboarding().pipe(Layer.provide(SeedAuditEventLog([]))),
    testWorkspaceContext(workspace, who)
  )
}

/** Turns a typed failure into a value, so a denial is asserted not thrown. */
function outcome<A, E extends { readonly _tag: string; readonly reason?: string }, R>(
  effect: Effect.Effect<A, E, R>
) {
  return Effect.match(effect, {
    onSuccess: (value) => ({ tag: 'ok', value }),
    onFailure: (failure) => ({ tag: failure._tag, reason: failure.reason })
  })
}

function dismissAs(who: Actor | null) {
  return Effect.runPromise(
    Effect.scoped(
      outcome(dismissOnboardingChecklist()).pipe(Effect.provide(layerFor(who)))
    )
  )
}

describe('dismissOnboardingChecklist', () => {
  it('lets an owner dismiss, once', async () => {
    const layer = layerFor(actor('owner'))
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.all([
          outcome(dismissOnboardingChecklist()),
          outcome(dismissOnboardingChecklist())
        ]).pipe(Effect.provide(layer))
      )
    )
    expect(result).toEqual([
      { tag: 'ok', value: true },
      { tag: 'ok', value: false }
    ])
  })

  it('lets an admin dismiss', async () => {
    expect(await dismissAs(actor('admin'))).toEqual({ tag: 'ok', value: true })
  })

  it('denies a plain member — the checklist is read-only for them', async () => {
    expect(await dismissAs(actor('member'))).toEqual({
      tag: 'AuthorizationDenied',
      reason: 'insufficient_permission'
    })
  })

  it('fails closed with no resolved actor', async () => {
    expect(await dismissAs(null)).toEqual({
      tag: 'AuthorizationDenied',
      reason: 'no_principal'
    })
  })
})

// The dashboard loader against the Seed layer: `usr_demo` owns `starter-lab`,
// `usr_dev` is a plain member of it.
describe('loadWorkspaceDashboard progress', () => {
  it('shows the owner the Seed Workspace partially complete', async () => {
    const payload = await loadWorkspaceDashboard({
      workspaceSlug: 'starter-lab',
      userId: 'usr_demo'
    })
    expect(payload.progress.totalCount).toBe(4)
    expect(payload.progress.completedCount).toBe(3)
    expect(payload.progress.dismissedAt).toBeNull()
  })

  it('omits the token and webhook steps for a member', async () => {
    const payload = await loadWorkspaceDashboard({
      workspaceSlug: 'starter-lab',
      userId: 'usr_dev'
    })
    expect(payload.progress.steps.map((step) => step.id)).toEqual([
      'invite_member',
      'enable_two_factor'
    ])
  })
})
