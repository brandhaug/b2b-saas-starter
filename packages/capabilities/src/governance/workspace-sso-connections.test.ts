import { Effect, Layer, Option } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { MembershipChangeRejected } from '../errors.ts'
import {
  seedMembers,
  seedSsoConnections,
  seedWorkspaceRecord
} from '../seed-fixture.ts'
import {
  testWorkspaceContext,
  type Actor,
  type WorkspaceContext
} from '../workspace-context.ts'
import { AuditEventLog, SeedAuditEventLog } from './audit-event-log.ts'
import {
  emailDomain,
  matchesEmailDomain,
  SsoConnections
} from './workspace-sso-connections.ts'
import { SeedSsoConnections } from './workspace-sso-connections.seed.ts'

/**
 * The Seed adapter's half of the SSO connection contract, plus the pure
 * domain-routing rule. The plugin's own behaviour (protocol validation,
 * provisioning at sign-in) belongs to `packages/auth`; the Live adapter's half
 * (scoping, read-back, audit) runs against D1 in
 * `workspace-sso-connections.live.test.ts`.
 */

const owner: Actor = { userId: 'usr_demo', role: 'owner', systemRole: 'admin' }

/** One fresh pair of layers per case: both adapters append to private copies. */
function provide<A, E>(
  effect: Effect.Effect<A, E, SsoConnections | AuditEventLog | WorkspaceContext>
) {
  const audit = SeedAuditEventLog([], seedMembers)
  return effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        SeedSsoConnections(seedSsoConnections).pipe(Layer.provide(audit)),
        audit,
        testWorkspaceContext(seedWorkspaceRecord, owner)
      )
    )
  )
}

describe('domain routing rule (pure)', () => {
  it('extracts the domain after the last @, lower-cased', () => {
    expect(emailDomain('User@Acme.COM')).toBe('acme.com')
    expect(emailDomain('first.last@sub.acme.com')).toBe('sub.acme.com')
    expect(emailDomain('no-at-sign')).toBeNull()
    expect(emailDomain('trailing@')).toBeNull()
  })

  it('matches a comma-separated domain list, case-insensitively', () => {
    expect(matchesEmailDomain('a@acme.com', 'ACME.com')).toBe(true)
    expect(matchesEmailDomain('a@sub.acme.com', 'acme.com, other.com')).toBe(false)
    expect(matchesEmailDomain('a@other.com', 'acme.com, other.com')).toBe(true)
    expect(matchesEmailDomain('a@acme.com.mallory.test', 'acme.com')).toBe(false)
  })
})

describe('SeedSsoConnections', () => {
  it.effect('lists the workspace’s connections, secrets never leaving the row', () =>
    provide(
      Effect.gen(function* () {
        const sso = yield* SsoConnections
        const connections = yield* sso.list
        expect(connections).toHaveLength(1)
        expect(connections[0]).toMatchObject({
          id: 'sso_example_oidc',
          protocol: 'oidc',
          domain: 'acme-corp.example',
          enabled: false,
          requireSso: false,
          defaultWorkspaceRole: 'member',
          clientIdLastFour: '7f2a'
        })
      })
    )
  )

  it.effect(
    'routes only enabled connections — the seeded example never intercepts',
    () =>
      provide(
        Effect.gen(function* () {
          const sso = yield* SsoConnections
          // The fixture connection matches this domain but is disabled.
          expect(
            Option.isNone(yield* sso.resolveRouting('someone@acme-corp.example'))
          ).toBe(true)
          expect(Option.isNone(yield* sso.resolveRouting('x@nowhere.test'))).toBe(true)
        })
      )
  )

  it.effect('creates a disabled connection and audits it', () =>
    provide(
      Effect.gen(function* () {
        const sso = yield* SsoConnections
        const created = yield* sso.create({
          protocol: 'oidc',
          domain: 'northwind.test',
          issuer: 'https://login.northwind.test',
          clientId: 'client-wxyz',
          clientSecret: 'sekrit',
          endpoints: {
            authorizationEndpoint: 'https://login.northwind.test/authorize',
            tokenEndpoint: 'https://login.northwind.test/token',
            jwksEndpoint: 'https://login.northwind.test/jwks'
          },
          defaultWorkspaceRole: 'admin'
        })
        // New connections start disabled: an owner enables one after testing
        // it, so a half-configured IdP never intercepts sign-ins.
        expect(created.enabled).toBe(false)
        expect(created.requireSso).toBe(false)
        expect(created.defaultWorkspaceRole).toBe('admin')
        expect(created.clientIdLastFour).toBe('wxyz')

        const routing = yield* sso.resolveRouting('new@northwind.test')
        expect(Option.isNone(routing)).toBe(true)

        const audit = yield* AuditEventLog
        const events = yield* audit.list({
          eventType: 'workspace_sso.connection_created'
        })
        expect(events.events).toHaveLength(1)
      })
    )
  )

  it.effect('enabling a connection makes its domain route to it', () =>
    provide(
      Effect.gen(function* () {
        const sso = yield* SsoConnections
        const created = yield* sso.create({
          protocol: 'oidc',
          domain: 'northwind.test',
          issuer: 'https://login.northwind.test',
          clientId: 'client-wxyz',
          clientSecret: 'sekrit',
          endpoints: {
            authorizationEndpoint: 'https://login.northwind.test/authorize',
            tokenEndpoint: 'https://login.northwind.test/token',
            jwksEndpoint: 'https://login.northwind.test/jwks'
          },
          defaultWorkspaceRole: 'member'
        })
        yield* sso.update({
          providerId: created.id,
          enabled: true,
          requireSso: true
        })
        const routing = yield* sso.resolveRouting('New.Person@NORTHWIND.test')
        expect(Option.isSome(routing)).toBe(true)
        if (Option.isSome(routing)) {
          expect(routing.value).toEqual({
            providerId: created.id,
            protocol: 'oidc',
            workspaceId: seedWorkspaceRecord.id,
            requireSso: true
          })
        }
      })
    )
  )

  it.effect('updating an unknown id yields None with no audit event', () =>
    provide(
      Effect.gen(function* () {
        const sso = yield* SsoConnections
        const updated = yield* sso.update({
          providerId: 'sso_missing',
          enabled: true
        })
        expect(Option.isNone(updated)).toBe(true)
        const audit = yield* AuditEventLog
        const events = yield* audit.list({
          eventType: 'workspace_sso.connection_updated'
        })
        expect(events.events).toHaveLength(0)
      })
    )
  )

  it.effect('refuses OIDC credentials on a SAML connection', () =>
    provide(
      Effect.gen(function* () {
        const sso = yield* SsoConnections
        const created = yield* sso.create({
          protocol: 'saml',
          domain: 'northwind.test',
          issuer: 'https://app.origin.test',
          metadataXml: '<EntityDescriptor entityID="https://idp.northwind.test">',
          entryPoint: 'https://idp.northwind.test/sso',
          defaultWorkspaceRole: 'member'
        })
        const failure = yield* Effect.flip(
          sso.update({
            providerId: created.id,
            oidcCredentials: { clientId: 'c', clientSecret: 's' }
          })
        )
        expect(failure).toBeInstanceOf(MembershipChangeRejected)
      })
    )
  )

  it.effect('removes a connection and audits it', () =>
    provide(
      Effect.gen(function* () {
        const sso = yield* SsoConnections
        expect(yield* sso.remove({ providerId: 'sso_example_oidc' })).toBe(true)
        expect(yield* sso.remove({ providerId: 'sso_example_oidc' })).toBe(false)
        const connections = yield* sso.list
        expect(connections).toHaveLength(0)
        const audit = yield* AuditEventLog
        const events = yield* audit.list({
          eventType: 'workspace_sso.connection_removed'
        })
        expect(events.events).toHaveLength(1)
      })
    )
  )
})
