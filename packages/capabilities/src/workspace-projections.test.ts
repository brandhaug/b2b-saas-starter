import { Effect, Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { SeedBilling } from './billing/billing.ts'
import { SeedApiTokenRegistry } from './developer-platform/api-token-registry.seed.ts'
import { ApiTokenRegistry } from './developer-platform/api-token-registry.ts'
import { SeedWebhookEndpoints } from './developer-platform/webhook-endpoints.seed.ts'
import { SeedWebhookPublisher } from './developer-platform/webhook-publisher.ts'
import { AuditEventLog, SeedAuditEventLog } from './governance/audit-event-log.ts'
import {
  makeSeedRoster,
  SeedWorkspaceMembership
} from './governance/workspace-membership.ts'
import {
  SeedWorkspaceOnboarding,
  WorkspaceOnboarding,
  type SeedWorkspaceOnboardingOptions
} from './governance/workspace-onboarding.ts'
import { type Member } from './governance/workspace-identity.ts'
import { SeedLayer } from './layers.ts'
import {
  demoUserIdentity,
  seedApiTokens,
  seedMembers,
  seedWebhookEndpoints,
  seedWorkspaceRecord
} from './seed-fixture.ts'
import { testWorkspaceContext, type Actor } from './workspace-context.ts'
import { workspaceProgress } from './workspace-projections.ts'

/**
 * `workspaceProgress` against purpose-built Seed layers: each case states the
 * capability facts and asserts the steps they derive to. Nothing is stored
 * except the dismissal, which is why the same layer answers differently after
 * a token is revoked or a member joins.
 */

const OWNER: Actor = { userId: demoUserIdentity.id, role: 'owner', systemRole: 'admin' }

type Fixture = {
  readonly members?: ReadonlyArray<Member>
  readonly tokens?: typeof seedApiTokens
  readonly webhooks?: typeof seedWebhookEndpoints
  readonly stripeConfigured?: boolean
  readonly onboarding?: SeedWorkspaceOnboardingOptions
  readonly actor?: Actor | null
}

function fixtureLayer(fixture: Fixture) {
  const audit = SeedAuditEventLog([])
  return Layer.unwrap(
    Effect.gen(function* () {
      const roster = yield* makeSeedRoster(fixture.members ?? [demoUserIdentity])
      // `null` is a real value here (no actor), so `??` would be wrong.
      let actor: Actor | null = OWNER
      if (fixture.actor !== undefined) {
        actor = fixture.actor
      }
      return Layer.mergeAll(
        audit,
        testWorkspaceContext(seedWorkspaceRecord, actor),
        SeedWorkspaceMembership(roster, seedWorkspaceRecord),
        SeedApiTokenRegistry(fixture.tokens ?? []).pipe(
          Layer.provide(audit),
          Layer.provide(SeedWebhookPublisher)
        ),
        SeedWebhookEndpoints(fixture.webhooks ?? []).pipe(
          Layer.provide(audit),
          Layer.provide(SeedWebhookPublisher)
        ),
        SeedBilling({ stripeConfigured: fixture.stripeConfigured ?? false }).pipe(
          Layer.provide(audit)
        ),
        SeedWorkspaceOnboarding(fixture.onboarding ?? {}).pipe(Layer.provide(audit))
      )
    })
  )
}

function completedIds(steps: ReadonlyArray<{ id: string; complete: boolean }>) {
  return steps.filter((step) => step.complete).map((step) => step.id)
}

describe('workspaceProgress', () => {
  it.effect('is empty for a fresh single-owner workspace without billing', () =>
    Effect.gen(function* () {
      const progress = yield* workspaceProgress({ developerPlatform: true })
      expect(progress.steps.map((step) => step.id)).toEqual([
        'invite_member',
        'create_api_token',
        'add_webhook_endpoint',
        'enable_two_factor'
      ])
      expect(progress.completedCount).toBe(0)
      expect(progress.totalCount).toBe(4)
      expect(progress.dismissedAt).toBeNull()
    }).pipe(Effect.provide(fixtureLayer({})))
  )

  it.effect('derives each step from the owning capability', () =>
    Effect.gen(function* () {
      const progress = yield* workspaceProgress({ developerPlatform: true })
      expect(completedIds(progress.steps)).toEqual([
        'invite_member',
        'create_api_token',
        'add_webhook_endpoint'
      ])
      expect(progress.completedCount).toBe(3)
    }).pipe(
      Effect.provide(
        fixtureLayer({
          members: seedMembers,
          tokens: seedApiTokens,
          webhooks: seedWebhookEndpoints
        })
      )
    )
  )

  it.effect(
    'ticks two-factor for the actor whose account has it, not the workspace',
    () =>
      Effect.gen(function* () {
        const progress = yield* workspaceProgress({ developerPlatform: true })
        expect(completedIds(progress.steps)).toEqual(['enable_two_factor'])
      }).pipe(
        Effect.provide(
          fixtureLayer({ onboarding: { twoFactorUserIds: [demoUserIdentity.id] } })
        )
      )
  )

  it.effect('leaves two-factor open with no actor in context', () =>
    Effect.gen(function* () {
      const progress = yield* workspaceProgress({ developerPlatform: true })
      expect(completedIds(progress.steps)).toEqual([])
    }).pipe(
      Effect.provide(
        fixtureLayer({
          actor: null,
          onboarding: { twoFactorUserIds: [demoUserIdentity.id] }
        })
      )
    )
  )

  it.effect('adds the plan step only when billing is configured', () =>
    Effect.gen(function* () {
      const progress = yield* workspaceProgress({ developerPlatform: true })
      expect(progress.totalCount).toBe(5)
      // The seed workspace is on the `team` plan, so the step is already done.
      expect(completedIds(progress.steps)).toEqual(['choose_plan'])
    }).pipe(Effect.provide(fixtureLayer({ stripeConfigured: true })))
  )

  it.effect(
    'omits the developer-platform steps when the caller may not read them',
    () =>
      Effect.gen(function* () {
        const progress = yield* workspaceProgress({ developerPlatform: false })
        expect(progress.steps.map((step) => step.id)).toEqual([
          'invite_member',
          'enable_two_factor'
        ])
        expect(progress.totalCount).toBe(2)
      }).pipe(Effect.provide(fixtureLayer({ tokens: seedApiTokens })))
  )

  it.effect('reopens a step when the thing behind it goes away', () =>
    Effect.gen(function* () {
      const before = yield* workspaceProgress({ developerPlatform: true })
      expect(completedIds(before.steps)).toEqual(['create_api_token'])
      const tokens = yield* ApiTokenRegistry
      yield* tokens.revoke({ tokenId: seedApiTokens[0]!.id })
      const after = yield* workspaceProgress({ developerPlatform: true })
      expect(completedIds(after.steps)).toEqual([])
    }).pipe(Effect.provide(fixtureLayer({ tokens: [seedApiTokens[0]!] })))
  )

  it.effect('reports and records a dismissal once', () =>
    Effect.gen(function* () {
      const onboarding = yield* WorkspaceOnboarding
      expect(yield* onboarding.dismiss).toBe(true)
      expect(yield* onboarding.dismiss).toBe(false)
      const progress = yield* workspaceProgress({ developerPlatform: true })
      expect(progress.dismissedAt).not.toBeNull()
      const audit = yield* AuditEventLog
      const page = yield* audit.list({})
      expect(
        page.events.filter(
          (event) => event.eventType === 'workspace.onboarding_dismissed'
        )
      ).toHaveLength(1)
    }).pipe(Effect.provide(fixtureLayer({})))
  )

  it.effect('shows the Seed Workspace partially complete for the demo owner', () =>
    Effect.gen(function* () {
      const progress = yield* workspaceProgress({ developerPlatform: true })
      expect(progress.totalCount).toBe(4)
      expect(progress.completedCount).toBe(3)
      expect(completedIds(progress.steps)).not.toContain('enable_two_factor')
      expect(progress.dismissedAt).toBeNull()
    }).pipe(
      Effect.provide(
        Layer.merge(SeedLayer, testWorkspaceContext(seedWorkspaceRecord, OWNER))
      )
    )
  )
})
