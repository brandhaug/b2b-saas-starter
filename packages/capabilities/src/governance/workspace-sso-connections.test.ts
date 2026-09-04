import { Effect, Layer, Option } from 'effect'
import { describe, expect, it } from '@effect/vitest'

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
import { type AuditEventLog, SeedAuditEventLog } from './audit-event-log.ts'
import {
  emailDomain,
  matchesDomain,
  matchesEmailDomain,
  SsoConnections
} from './workspace-sso-connections.ts'
import { workspaceSsoConnectionsContractCases } from './workspace-sso-connections.contract.ts'
import { SeedSsoConnections } from './workspace-sso-connections.seed.ts'

/**
 * The Seed adapter's half of the SSO connection contract, plus the pure
 * domain-routing rule and the fixture-planted reads the contract cases cannot
 * express (they create their own rows). The plugin's own behaviour (protocol
 * validation, provisioning at sign-in) belongs to `packages/auth`; the Live
 * adapter's half (scoping, read-back, audit) runs against D1 in
 * `workspace-sso-connections.live.test.ts`, which runs the same contract list.
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

  it('matches a bare domain against a comma-separated list, case-insensitively', () => {
    expect(matchesDomain('ACME.com', 'acme.com')).toBe(true)
    expect(matchesDomain('other.com', 'acme.com, other.com')).toBe(true)
    expect(matchesDomain('sub.acme.com', 'acme.com')).toBe(false)
    expect(matchesDomain('acme.com.mallory.test', 'acme.com')).toBe(false)
    expect(matchesDomain('', 'acme.com')).toBe(false)
  })

  it('matches an email’s domain against the same list', () => {
    expect(matchesEmailDomain('a@acme.com', 'ACME.com')).toBe(true)
    expect(matchesEmailDomain('a@sub.acme.com', 'acme.com, other.com')).toBe(false)
    expect(matchesEmailDomain('a@other.com', 'acme.com, other.com')).toBe(true)
    expect(matchesEmailDomain('a@acme.com.mallory.test', 'acme.com')).toBe(false)
  })
})

describe('SeedSsoConnections (fixture reads)', () => {
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
})

// The Live half of this same list runs in `workspace-sso-connections.live.test.ts`.
// Two adapters, one contract — capabilities invariant 4. Each case creates the
// connections it asserts on, under its own slot's domain.
describe('seed workspace sso connections contract', () => {
  for (const contractCase of workspaceSsoConnectionsContractCases(
    (slot) => `${slot}.contract.test`,
    expect
  )) {
    it.effect(contractCase.name, () => provide(contractCase.assert))
  }
})
