import { Effect, Option } from 'effect'
import { type ContractExpectMatchers } from './contract-expect.ts'
import { type CapabilityUnavailable, type MembershipChangeRejected } from '../errors.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { type WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import {
  SsoConnections,
  type CreateSsoConnectionInput
} from './workspace-sso-connections.ts'

/**
 * The SSO connection contract, written once and run against both adapters.
 *
 * Same reasoning as `workspace-membership.contract.ts`: capabilities invariant
 * 4 says Seed and Live must satisfy the same interface, and matching
 * TypeScript types do not prove it. The seed half runs in the capability's
 * `workspace-sso-connections.test.ts` harness with no D1; the live half runs
 * in `workspace-sso-connections.live.test.ts` against real D1 through the
 * `fakeSsoBinding` stand-in.
 *
 * The cases are self-sufficient — each creates the connections it asserts on,
 * under its own domain, so neither harness plants fixtures for them. The
 * audit assertions count before/after rather than exact lengths, because the
 * two harnesses start from different audit histories. The cases assert only
 * what both adapters can honestly promise; generated ids are deliberately
 * absent.
 */

export type SsoContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable | MembershipChangeRejected,
    SsoConnections | AuditEventLog | WorkspaceContext
  >
}

/** The slice of vitest's `expect` these cases use — see `workspace-membership.contract.ts`. */
export type SsoContractExpect = <A>(
  actual: A
) => Pick<ContractExpectMatchers<A>, 'toBe' | 'toHaveLength'>

/** The OIDC create input every case registers under its own domain. */
function oidcCreate(domain: string): CreateSsoConnectionInput {
  return {
    protocol: 'oidc',
    domain,
    issuer: `https://login.${domain}`,
    clientId: `client-${domain}`,
    clientSecret: 'sekrit',
    endpoints: {
      authorizationEndpoint: `https://login.${domain}/authorize`,
      tokenEndpoint: `https://login.${domain}/token`,
      jwksEndpoint: `https://login.${domain}/jwks`
    },
    defaultWorkspaceRole: 'admin'
  }
}

/**
 * One fresh domain per case: the routing rule matches on domain, so cases
 * must not share one. Both harnesses call this with distinct slots.
 */
export function workspaceSsoConnectionsContractCases(
  domainFor: (slot: string) => string,
  expect: SsoContractExpect
): ReadonlyArray<SsoContractCase> {
  return [
    {
      name: 'creates a born-disabled OIDC connection, sanitized and unrouted',
      assert: Effect.gen(function* () {
        const sso = yield* SsoConnections
        const domain = domainFor('create')

        const created = yield* sso.create(oidcCreate(domain))
        // New connections start disabled: an owner enables one after testing
        // it. The DTO carries the client id's last four, never the id or the
        // secret.
        expect(created.enabled).toBe(false)
        expect(created.requireSso).toBe(false)
        expect(created.defaultWorkspaceRole).toBe('admin')
        expect(created.clientIdLastFour).toBe(domain.slice(-4))

        const listed = yield* sso.list
        const sanitized = listed.find((connection) => connection.id === created.id)
        expect(sanitized?.enabled).toBe(false)

        const routing = yield* sso.resolveRouting(`someone@${domain}`)
        expect(Option.isNone(routing)).toBe(true)
      })
    },
    {
      name: 'resolveSignInTarget answers a disabled connection resolveRouting refuses',
      assert: Effect.gen(function* () {
        const sso = yield* SsoConnections
        const domain = domainFor('sign-in-target')

        const created = yield* sso.create(oidcCreate(domain))

        // The auth gate reads the raw resolution — disabled included — while
        // the page-level routing filters it. One row, two consumers.
        const target = yield* sso.resolveSignInTarget({ email: `a@${domain}` })
        expect(Option.isSome(target)).toBe(true)
        if (Option.isSome(target)) {
          expect(target.value.providerId).toBe(created.id)
          expect(target.value.enabled).toBe(false)
        }
        expect(Option.isNone(yield* sso.resolveRouting(`a@${domain}`))).toBe(true)

        const byId = yield* sso.resolveSignInTarget({ providerId: created.id })
        expect(Option.isSome(byId)).toBe(true)
        expect(
          Option.isNone(yield* sso.resolveSignInTarget({ providerId: 'sso_x' }))
        ).toBe(true)
        expect(Option.isNone(yield* sso.resolveSignInTarget({}))).toBe(true)
      })
    },
    {
      name: 'enabling makes the domain route with the required role, and audits it',
      assert: Effect.gen(function* () {
        const sso = yield* SsoConnections
        const audit = yield* AuditEventLog
        const domain = domainFor('enable')

        const created = yield* sso.create(oidcCreate(domain))
        const updated = yield* sso.update({
          providerId: created.id,
          enabled: true,
          requireSso: true
        })
        expect(Option.isSome(updated)).toBe(true)

        const routing = yield* sso.resolveRouting(`New.Person@${domain.toUpperCase()}`)
        expect(Option.isSome(routing)).toBe(true)
        if (Option.isSome(routing)) {
          expect(routing.value.providerId).toBe(created.id)
          expect(routing.value.requireSso).toBe(true)
        }

        const events = yield* audit.list({
          eventType: 'workspace_sso.connection_updated'
        })
        expect(events.events.some((event) => event.targetId === created.id)).toBe(true)
      })
    },
    {
      name: 'refuses OIDC credentials on a SAML connection',
      assert: Effect.gen(function* () {
        const sso = yield* SsoConnections
        const domain = domainFor('protocol')

        const created = yield* sso.create({
          protocol: 'saml',
          domain,
          issuer: 'https://app.origin.test',
          metadataXml: `<EntityDescriptor entityID="https://idp.${domain}">`,
          entryPoint: `https://idp.${domain}/sso`,
          defaultWorkspaceRole: 'member'
        })

        const outcome = yield* Effect.exit(
          sso.update({
            providerId: created.id,
            oidcCredentials: { clientId: 'c', clientSecret: 's' }
          })
        )
        expect(failureTag(outcome)).toBe('MembershipChangeRejected')
      })
    },
    {
      name: 'updating an unknown id yields None and audits nothing',
      assert: Effect.gen(function* () {
        const sso = yield* SsoConnections
        const audit = yield* AuditEventLog

        const before = yield* audit.list({
          eventType: 'workspace_sso.connection_updated'
        })
        const updated = yield* sso.update({
          providerId: 'sso_missing',
          enabled: true
        })
        expect(Option.isNone(updated)).toBe(true)
        const after = yield* audit.list({
          eventType: 'workspace_sso.connection_updated'
        })
        expect(after.events).toHaveLength(before.events.length)
      })
    },
    {
      name: 'removes a connection once, audits it, then removes nothing',
      assert: Effect.gen(function* () {
        const sso = yield* SsoConnections
        const audit = yield* AuditEventLog
        const domain = domainFor('remove')

        const created = yield* sso.create(oidcCreate(domain))
        expect(yield* sso.remove({ providerId: created.id })).toBe(true)
        expect(yield* sso.remove({ providerId: created.id })).toBe(false)

        const events = yield* audit.list({
          eventType: 'workspace_sso.connection_removed'
        })
        expect(events.events.some((event) => event.targetId === created.id)).toBe(true)

        const listed = yield* sso.list
        expect(listed.some((connection) => connection.id === created.id)).toBe(false)
      })
    }
  ]
}
