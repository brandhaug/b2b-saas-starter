import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { SeedAuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  makeSeedRoster,
  SeedWorkspaceMembership
} from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import {
  type Member,
  type Workspace
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { SeedSeatSyncPublisher } from '@b2b-saas-starter/capabilities/billing/seat-sync'
import { SeedNotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed.seed'
import { SeedNotificationPreferences } from '@b2b-saas-starter/capabilities/notifications/notification-preferences'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { Effect, Layer } from 'effect'

import { fixtureSession } from '@/test/fixture-session'
import {
  createSsoConnectionHandler,
  notifyOwnersOfFailedTest,
  removeSsoConnectionHandler,
  testSsoConnectionHandler,
  updateSsoConnectionHandler
} from './workspace-sso.effects'
import type * as AuthModule from './auth'

/**
 * The workspace-SSO server functions through their handlers: the session
 * gate is answered by the mock with the fixture identity under test, and the
 * rest is the real path over the Seed layer (the inert `cloudflare:workers`
 * shim under Vitest). The seed carries one disabled OIDC connection
 * (`sso_example_oidc`, issuer `login.acme-corp.example`) — unreachable from
 * a test run, which is exactly the failed-test state. `usr_demo` owns
 * `starter-lab`, `usr_ops` is its admin, `usr_dev` a plain member.
 *
 * Real clock, plain `it` + `await`: the effects read the wall clock through
 * the IdP fetch.
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))

vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireRequestSession: async () => fixtureSession(actor)
}))

const OWNER = 'usr_demo'
const ADMIN = 'usr_ops'
const MEMBER = 'usr_dev'

describe('workspace SSO handlers — settings form permissions', () => {
  beforeEach(() => {
    actor.userId = OWNER
  })

  it('refuses create for a member with the guard’s denial', async () => {
    actor.userId = MEMBER
    await expect(
      createSsoConnectionHandler({
        workspaceSlug: 'starter-lab',
        protocol: 'oidc',
        domain: 'northwind.test',
        issuer: 'https://login.northwind.test',
        clientId: 'client-x',
        clientSecret: 'secret-x',
        defaultWorkspaceRole: 'member'
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('refuses update and remove for a member', async () => {
    actor.userId = MEMBER
    await expect(
      updateSsoConnectionHandler({
        workspaceSlug: 'starter-lab',
        providerId: 'sso_example_oidc',
        enabled: true
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
    await expect(
      removeSsoConnectionHandler({
        workspaceSlug: 'starter-lab',
        providerId: 'sso_example_oidc'
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('an admin may update — the matrix grants sso:update to admins', async () => {
    actor.userId = ADMIN
    const updated = await updateSsoConnectionHandler({
      workspaceSlug: 'starter-lab',
      providerId: 'sso_example_oidc',
      enabled: true
    })
    expect(updated).toMatchObject({ id: 'sso_example_oidc', enabled: true })
  })
})

describe('workspace SSO handlers — create-time IdP validation', () => {
  beforeEach(() => {
    actor.userId = OWNER
  })

  it('refuses an issuer whose discovery document cannot be fetched', async () => {
    // No network in tests: `login.northwind.test` does not resolve, which is
    // exactly the refused state the form should see for a typo'd issuer.
    await expect(
      createSsoConnectionHandler({
        workspaceSlug: 'starter-lab',
        protocol: 'oidc',
        domain: 'northwind.test',
        issuer: 'https://login.northwind.test',
        clientId: 'client-x',
        clientSecret: 'secret-x',
        defaultWorkspaceRole: 'member'
      })
    ).rejects.toMatchObject({ code: 'discovery_unreachable' })
  })
})

describe('workspace SSO handlers — the test step', () => {
  beforeEach(() => {
    actor.userId = OWNER
  })

  it('reports a failed test without refusing the request', async () => {
    const result = await testSsoConnectionHandler({
      workspaceSlug: 'starter-lab',
      providerId: 'sso_example_oidc'
    })
    // The stored issuer is unreachable from a test run — the verdict is the
    // answer, not an error.
    expect(result).toMatchObject({ outcome: 'failed', code: 'discovery_unreachable' })
  })

  it('answers "failed" for an unknown connection without refusing', async () => {
    const result = await testSsoConnectionHandler({
      workspaceSlug: 'starter-lab',
      providerId: 'sso_missing'
    })
    expect(result).toMatchObject({
      outcome: 'failed',
      code: 'connection_not_found'
    })
  })
})

describe('notifyOwnersOfFailedTest — the owner fan-out rule', () => {
  // The handler seam builds a fresh Seed layer per call, so it can neither
  // stage a roster nor read the feed back. The rule itself — every owner
  // hears about a failed connection, nobody else does, and the notification
  // names the domain — is driven directly against Seed capability layers.
  const workspace: Workspace = {
    id: 'wrk_sso_notify',
    slug: 'sso-lab',
    name: 'SSO Lab',
    planId: 'team'
  }

  const members: ReadonlyArray<Member> = [
    {
      id: 'usr_notify_owner',
      name: 'Owner',
      email: 'owner@sso.test',
      role: 'owner',
      systemRole: 'user'
    },
    {
      id: 'usr_notify_admin',
      name: 'Admin',
      email: 'admin@sso.test',
      role: 'admin',
      systemRole: 'user'
    },
    {
      id: 'usr_notify_member',
      name: 'Member',
      email: 'member@sso.test',
      role: 'member',
      systemRole: 'user'
    }
  ]

  const connection = {
    id: 'sso_notify_oidc',
    protocol: 'oidc',
    domain: 'acme.test',
    issuer: 'https://login.acme.test',
    enabled: true,
    requireSso: false,
    defaultWorkspaceRole: 'member',
    clientIdLastFour: '-x',
    createdAt: '2026-01-01T00:00:00.000Z'
  } satisfies Parameters<typeof notifyOwnersOfFailedTest>[0]

  const REASON = 'issuer unreachable'

  it('notifies every owner, only the owners, with the domain and reason', async () => {
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- server-fn handler pattern per apps/web/AGENTS.md keeps plain it (TestClock epoch 0 vs session-expiry fixtures)
    const visibleTo = await Effect.runPromise(
      Effect.gen(function* () {
        const roster = yield* makeSeedRoster(members)
        const services = Layer.mergeAll(
          SeedWorkspaceMembership(roster, workspace).pipe(
            Layer.provide(SeedSeatSyncPublisher)
          ),
          SeedNotificationFeed([]).pipe(
            Layer.provide(
              SeedNotificationPreferences([]).pipe(Layer.provide(SeedAuditEventLog([])))
            )
          )
        )
        return yield* Effect.scoped(
          Effect.gen(function* () {
            yield* notifyOwnersOfFailedTest(connection, REASON).pipe(
              Effect.provideService(WorkspaceContext, { workspace, actor: null })
            )
            const counts: Record<string, number> = {}
            const samples: Record<string, string | undefined> = {}
            for (const member of members) {
              const rows = yield* Effect.flatMap(
                NotificationFeed,
                (feed) => feed.list
              ).pipe(
                Effect.provideService(WorkspaceContext, {
                  workspace,
                  actor: { userId: member.id, role: member.role, systemRole: 'user' }
                })
              )
              counts[member.id] = rows.length
              samples[member.id] = rows[0]?.message
            }
            return { counts, samples }
          }).pipe(Effect.provide(services))
        )
      })
    )
    expect(visibleTo.counts).toEqual({
      usr_notify_owner: 1,
      usr_notify_admin: 0,
      usr_notify_member: 0
    })
    expect(visibleTo.samples.usr_notify_owner).toBe(
      'The OIDC connection for acme.test failed: issuer unreachable'
    )
  })
})
