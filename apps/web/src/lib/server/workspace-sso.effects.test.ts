import {
  makeSeedRoster,
  SeedWorkspaceMembership,
  type WorkspaceMembership
} from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { SeedNotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed.seed'
import {
  SeedNotificationPreferences,
  type NotificationPreferences
} from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import { seedNotificationPreferences } from '@b2b-saas-starter/capabilities/seed-fixture'
import { SeedSeatSyncPublisher } from '@b2b-saas-starter/capabilities/billing/seat-sync'
import { SeedAuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  SeedSsoConnections,
  type SeedSsoConnection
} from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections.seed'
import { type SsoConnections } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import {
  testWorkspaceContext,
  type Actor,
  type WorkspaceContext
} from '@b2b-saas-starter/capabilities/workspace-context'

import {
  type Member,
  type Workspace,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { describe, expect, it } from 'vite-plus/test'
import { Effect, Layer, type Scope } from 'effect'

import {
  createSsoConnection,
  removeSsoConnection,
  testSsoConnection,
  updateSsoConnection
} from './workspace-sso.effects'

/**
 * The workspace-SSO server-function behaviour below its session gate, on the
 * `invitations.test.ts` pattern: the effects are driven directly against
 * purpose-built fixture layers, so what is under test is the permission gates
 * (the settings form's owner/admin/member matrix), the create-time IdP
 * validation, and the notify-owners-on-failed-test rule — everything the
 * handlers add on top is one session read and one binding.
 *
 * Real clock, plain `it` + `Effect.runPromise`: `@effect/vitest`'s TestClock
 * starts at epoch 0 and these effects read the wall clock through the IdP
 * fetch stub and the notification `createdAt`.
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

const OWNER = actor('owner')
const ADMIN = actor('admin')
const MEMBER = actor('member')

/** The roster the membership capability reads owners off. */
const members: ReadonlyArray<Member> = [
  {
    id: OWNER.userId,
    name: 'Owner',
    email: 'owner@test.local',
    role: 'owner',
    systemRole: 'admin'
  },
  {
    id: MEMBER.userId,
    name: 'Member',
    email: 'member@test.local',
    role: 'member',
    systemRole: 'user'
  }
]

/** A connection whose stored OIDC detail points at an unreachable issuer. */
const brokenConnection: SeedSsoConnection = {
  id: 'sso_broken',
  protocol: 'oidc',
  domain: 'broken.test',
  issuer: 'https://login.broken.test',
  enabled: true,
  requireSso: false,
  defaultWorkspaceRole: 'member',
  clientIdLastFour: '0000',
  createdAt: '2026-05-15T09:30:00.000Z',
  workspaceId: workspace.id,
  oidc: {
    authorizationEndpoint: 'https://login.broken.test/authorize',
    tokenEndpoint: 'https://login.broken.test/token',
    jwksEndpoint: 'https://login.broken.test/jwks',
    userInfoEndpoint: null
  }
}

/** Every notification the feed was asked to record. */
type Recorded = ReadonlyArray<{
  readonly title: string
  readonly message: string
  readonly userId: string | null
}>

/** The mutable holder a test reads after running an effect. */
type RecordedNotifications = { current: Recorded }

/**
 * A seed feed that remembers what it was asked to record, built on top of the
 * plain seed feed (the tag is an Effect of its own service, so one layer can
 * wrap another's).
 */
function recordingFeed(recorded: {
  current: Recorded
}): Layer.Layer<NotificationFeed, never, NotificationPreferences> {
  return Layer.effect(NotificationFeed)(
    Effect.map(NotificationFeed, (inner) => ({
      ...inner,
      record: (input: {
        readonly title: string
        readonly message: string
        readonly userId: string
      }) => {
        recorded.current = [...recorded.current, input]
        return inner.record(input)
      }
    }))
  ).pipe(Layer.provide(SeedNotificationFeed([])))
}

function provide<A, E>(
  effect: Effect.Effect<
    A,
    E,
    | WorkspaceContext
    | NotificationFeed
    | SsoConnections
    | WorkspaceMembership
    | Scope.Scope
  >,
  who: Actor,
  options: {
    readonly connections?: ReadonlyArray<SeedSsoConnection>
    readonly recorded?: RecordedNotifications | undefined
  } = {}
): Promise<A> {
  // The feed reads the member's notification preferences, so the preferences
  // layer rides underneath — the same wiring `layers.ts` composes.
  const preferences = SeedNotificationPreferences(seedNotificationPreferences).pipe(
    Layer.provide(SeedAuditEventLog([], members))
  )
  return Effect.runPromise(
    Effect.scoped(effect).pipe(
      Effect.provide(
        Layer.mergeAll(
          SeedSsoConnections(options.connections ?? [brokenConnection]).pipe(
            Layer.provide(SeedAuditEventLog([], members))
          ),
          SeedWorkspaceMembership(
            // The roster is an Effect; built inside `provide`, fresh per call.
            Effect.runSync(makeSeedRoster(members)),
            workspace
          ),
          options.recorded === undefined
            ? SeedNotificationFeed([])
            : recordingFeed(options.recorded),
          testWorkspaceContext(workspace, who)
        ).pipe(
          // Membership changes trigger seat sync (ADR 0060) and the feed
          // reads notification preferences — the same wiring `layers.ts`
          // composes for both.
          Layer.provide(SeedSeatSyncPublisher),
          Layer.provide(preferences)
        )
      )
    )
  )
}

describe('workspace SSO effects — settings form permissions', () => {
  it('refuses create for a member with the guard’s denial', async () => {
    const denial = await provide(
      Effect.flip(
        createSsoConnection({
          workspaceSlug: workspace.slug,
          protocol: 'oidc',
          domain: 'northwind.test',
          issuer: 'https://login.northwind.test',
          clientId: 'client-x',
          clientSecret: 'secret-x',
          defaultWorkspaceRole: 'member'
        })
      ),
      MEMBER
    )
    expect(denial).toMatchObject({ _tag: 'AuthorizationDenied' })
  })

  it('refuses update and remove for a member', async () => {
    const updateAttempt = await provide(
      Effect.flip(
        updateSsoConnection({
          workspaceSlug: workspace.slug,
          providerId: 'sso_broken',
          enabled: true
        })
      ),
      MEMBER
    )
    expect(updateAttempt).toMatchObject({ _tag: 'AuthorizationDenied' })

    const removeAttempt = await provide(
      Effect.flip(removeSsoConnection({ providerId: 'sso_broken' })),
      MEMBER
    )
    expect(removeAttempt).toMatchObject({ _tag: 'AuthorizationDenied' })
  })

  it('an admin may update — the matrix grants sso:update to admins', async () => {
    const updated = await provide(
      updateSsoConnection({
        workspaceSlug: workspace.slug,
        providerId: 'sso_broken',
        enabled: false
      }),
      ADMIN
    )
    expect(updated).toMatchObject({ enabled: false })
  })
})

describe('workspace SSO effects — create-time IdP validation', () => {
  it('refuses an issuer whose discovery document cannot be fetched', async () => {
    // No network in tests: `login.northwind.test` does not resolve, which is
    // exactly the refused state the form should see for a typo'd issuer.
    const failure = await provide(
      Effect.flip(
        createSsoConnection({
          workspaceSlug: workspace.slug,
          protocol: 'oidc',
          domain: 'northwind.test',
          issuer: 'https://login.northwind.test',
          clientId: 'client-x',
          clientSecret: 'secret-x',
          defaultWorkspaceRole: 'member'
        })
      ),
      OWNER
    )
    expect(failure).toMatchObject({ code: 'discovery_unreachable' })
  })
})

describe('workspace SSO effects — test step and owner notification', () => {
  it('reports a failed test and notifies the workspace owners only', async () => {
    const recorded: RecordedNotifications = { current: [] }
    const result = await provide(
      testSsoConnection({ providerId: 'sso_broken' }),
      OWNER,
      { recorded }
    )
    expect(result.outcome).toBe('failed')
    // One notification per owner — the plain member of the workspace gets none.
    expect(recorded.current).toHaveLength(1)
    expect(recorded.current[0]?.userId).toBe(OWNER.userId)
    expect(recorded.current[0]?.message).toContain('broken.test')
  })

  it('answers "failed" for an unknown connection without refusing', async () => {
    const result = await provide(
      testSsoConnection({ providerId: 'sso_missing' }),
      OWNER
    )
    expect(result).toMatchObject({
      outcome: 'failed',
      code: 'connection_not_found'
    })
  })
})
