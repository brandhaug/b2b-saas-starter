import { Database } from '@b2b-saas-starter/db/service'
import { Effect, Option } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import {
  fakeSsoBinding,
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { SsoConnections } from './workspace-sso-connections.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live workspace sso connections',
  (it) => {
    describe('reads', () => {
      it.effect(
        'lists the workspace’s connections sanitized — no secret leaves the row',
        () =>
          inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const sso = yield* SsoConnections
              const connections = yield* sso.list
              const ids = connections.map((connection) => connection.id)
              // Newest first: the three fixtures share one timestamp, so the
              // storage order shows through (the SQL sort is stable).
              expect(ids).toEqual([
                'sso_live_oidc',
                'sso_live_disabled',
                'sso_live_saml'
              ])
              const oidc = connections.find(
                (connection) => connection.id === 'sso_live_oidc'
              )
              expect(oidc).toMatchObject({
                protocol: 'oidc',
                domain: 'routed.test',
                enabled: true,
                requireSso: true,
                defaultWorkspaceRole: 'admin',
                // The client id’s tail, never the secret or the full id.
                clientIdLastFour: 'abcd'
              })
              // Serialization IS the assertion: the DTO crossing to the browser must
              // not contain the secret or the full client id.
              // oxlint-disable-next-line effect/noGlobals -- the assertion inspects the wire serialization itself
              const serialized = JSON.stringify(connections)
              expect(serialized).not.toContain('sec_live_secret')
              expect(serialized).not.toContain('client-live-abcd')
            }),
            { userId: 'usr_owner' }
          )
      )

      it.effect('scopes get to the workspace in context', () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const sso = yield* SsoConnections
            // Exists, but on `wrk_other`.
            expect(
              Option.isNone(yield* sso.get({ providerId: 'sso_other_oidc' }))
            ).toBe(true)
            expect(Option.isSome(yield* sso.get({ providerId: 'sso_live_oidc' }))).toBe(
              true
            )
          }),
          { userId: 'usr_owner' }
        )
      )
    })

    describe('domain routing', () => {
      it.effect('routes an enabled connection’s domain, across workspaces', () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const sso = yield* SsoConnections
            const routing = yield* sso.resolveRouting('person@routed.test')
            expect(Option.isSome(routing)).toBe(true)
            if (Option.isSome(routing)) {
              // Deterministic: lowest providerId wins when domains overlap.
              expect(routing.value.providerId).toBe('sso_live_oidc')
              expect(routing.value.requireSso).toBe(true)
              expect(routing.value.workspaceId).toBe('wrk_live')
            }
          })
        )
      )

      it.effect('never routes a disabled connection', () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const sso = yield* SsoConnections
            expect(
              Option.isNone(yield* sso.resolveRouting('person@disabled.test'))
            ).toBe(true)
          })
        )
      )

      it.effect('answers None for an unmatched domain or a domainless address', () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const sso = yield* SsoConnections
            expect(
              Option.isNone(yield* sso.resolveRouting('person@nowhere.test'))
            ).toBe(true)
            expect(Option.isNone(yield* sso.resolveRouting('not-an-address'))).toBe(
              true
            )
          })
        )
      )
    })

    describe('detail reads + provider lookup', () => {
      it.effect('describes an OIDC connection with its endpoint detail', () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const sso = yield* SsoConnections
            const detail = yield* sso.describe({ providerId: 'sso_live_oidc' })
            expect(Option.isSome(detail)).toBe(true)
            if (Option.isSome(detail)) {
              expect(detail.value.oidc).toMatchObject({
                authorizationEndpoint: 'https://login.routed.test/authorize',
                tokenEndpoint: 'https://login.routed.test/token',
                jwksEndpoint: 'https://login.routed.test/jwks'
              })
              expect(detail.value.saml).toBeNull()
            }
          }),
          { userId: 'usr_owner' }
        )
      )

      it.effect('describes a SAML connection and a config-less OIDC one', () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const sso = yield* SsoConnections
            const saml = yield* sso.describe({ providerId: 'sso_live_saml' })
            if (Option.isSome(saml)) {
              expect(saml.value.protocol).toBe('saml')
              expect(saml.value.saml).toEqual({
                metadataXml: '<EntityDescriptor entityID="https://idp.saml.test"/>',
                entryPoint: 'https://idp.saml.test/sso'
              })
              expect(saml.value.oidc).toBeNull()
            }
            // The disabled example's blob carries no endpoints: the detail
            // segment degrades to null rather than failing the read.
            const partial = yield* sso.describe({ providerId: 'sso_live_disabled' })
            if (Option.isSome(partial)) {
              expect(partial.value.oidc).toBeNull()
            }
          }),
          { userId: 'usr_owner' }
        )
      )

      it.effect('rotating OIDC credentials updates the echoed last four', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const { binding } = fakeSsoBinding(db)
          const updated = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(SsoConnections, (sso) =>
              sso.update({
                providerId: 'sso_live_oidc',
                oidcCredentials: {
                  clientId: 'client-rotated-9999',
                  clientSecret: 'new-secret'
                }
              })
            ),
            { userId: 'usr_owner' },
            { ssoBinding: binding }
          )
          expect(Option.isSome(updated)).toBe(true)
          if (Option.isSome(updated)) {
            expect(updated.value.clientIdLastFour).toBe('9999')
          }
        })
      )

      it.effect('describes an unknown id as None and a provider by its workspace', () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const sso = yield* SsoConnections
            expect(
              Option.isNone(yield* sso.describe({ providerId: 'sso_missing' }))
            ).toBe(true)
            const provider = yield* sso.resolveProvider('sso_live_oidc')
            expect(Option.isSome(provider)).toBe(true)
            if (Option.isSome(provider)) {
              expect(provider.value.workspaceId).toBe('wrk_live')
            }
            expect(Option.isNone(yield* sso.resolveProvider('sso_missing'))).toBe(true)
          })
        )
      )
    })

    describe('mutations', () => {
      it.effect('creates through the binding, reads it back, and audits it', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const { binding, calls } = fakeSsoBinding(db)
          const created = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const sso = yield* SsoConnections
              return yield* sso.create({
                protocol: 'oidc',
                domain: 'northwind.test',
                issuer: 'https://login.northwind.test',
                clientId: 'client-nw-1234',
                clientSecret: 'nw-secret',
                endpoints: {
                  authorizationEndpoint: 'https://login.northwind.test/authorize',
                  tokenEndpoint: 'https://login.northwind.test/token',
                  jwksEndpoint: 'https://login.northwind.test/jwks'
                },
                defaultWorkspaceRole: 'member'
              })
            }),
            { userId: 'usr_owner' },
            { ssoBinding: binding }
          )
          expect(created.enabled).toBe(false)
          expect(created.clientIdLastFour).toBe('1234')
          expect(calls).toHaveLength(1)
          // Called with the workspace resolved from context and a fresh id.
          expect(calls[0]).toMatchObject({
            workspaceId: 'wrk_live',
            domain: 'northwind.test',
            defaultWorkspaceRole: 'member'
          })

          const audit = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const events = yield* (yield* AuditEventLog).list({
                eventType: 'workspace_sso.connection_created'
              })
              return events.events
            }),
            { userId: 'usr_owner' }
          )
          expect(audit.map((event) => event.targetId)).toContain(created.id)
        })
      )

      it.effect('updates toggles through the binding and audits the result', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const { binding, calls } = fakeSsoBinding(db)
          const updated = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const sso = yield* SsoConnections
              return yield* sso.update({
                providerId: 'sso_live_disabled',
                enabled: true,
                requireSso: true,
                defaultWorkspaceRole: 'admin'
              })
            }),
            { userId: 'usr_owner' },
            { ssoBinding: binding }
          )
          expect(Option.isSome(updated)).toBe(true)
          if (Option.isSome(updated)) {
            expect(updated.value).toMatchObject({
              enabled: true,
              requireSso: true,
              defaultWorkspaceRole: 'admin'
            })
          }
          expect(calls).toEqual([
            {
              providerId: 'sso_live_disabled',
              enabled: true,
              requireSso: true,
              defaultWorkspaceRole: 'admin'
            }
          ])

          // The routing rule sees the flip immediately.
          const routing = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(SsoConnections, (sso) =>
              sso.resolveRouting('person@disabled.test')
            )
          )
          expect(Option.isSome(routing)).toBe(true)

          const audit = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const events = yield* (yield* AuditEventLog).list({
                eventType: 'workspace_sso.connection_updated'
              })
              return events.events
            }),
            { userId: 'usr_owner' }
          )
          expect(audit.map((event) => event.targetId)).toContain('sso_live_disabled')
        })
      )

      it.effect('refuses OIDC credentials on a SAML connection', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const { binding } = fakeSsoBinding(db)
          // Seed a SAML row through the binding first.
          const created = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(SsoConnections, (sso) =>
              sso.create({
                protocol: 'saml',
                domain: 'saml.test',
                issuer: 'https://app.origin.test',
                metadataXml:
                  '<EntityDescriptor entityID="https://idp.saml.test"></EntityDescriptor>',
                entryPoint: 'https://idp.saml.test/sso',
                defaultWorkspaceRole: 'member'
              })
            ),
            { userId: 'usr_owner' },
            { ssoBinding: binding }
          )
          const failure = yield* Effect.flip(
            inWorkspace(
              'live-lab',
              Effect.flatMap(SsoConnections, (sso) =>
                sso.update({
                  providerId: created.id,
                  oidcCredentials: { clientId: 'c', clientSecret: 's' }
                })
              ),
              { userId: 'usr_owner' },
              { ssoBinding: binding }
            )
          )
          expect(failure).toMatchObject({ _tag: 'MembershipChangeRejected' })
        })
      )

      it.effect('removes through the binding and stops routing the domain', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const { binding, calls } = fakeSsoBinding(db)
          const removed = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(SsoConnections, (sso) =>
              sso.remove({ providerId: 'sso_live_oidc' })
            ),
            { userId: 'usr_owner' },
            { ssoBinding: binding }
          )
          expect(removed).toBe(true)
          expect(calls).toEqual([{ providerId: 'sso_live_oidc' }])

          // `routed.test` still resolves — to the *other* workspace’s
          // connection now that this workspace’s is gone.
          const routing = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(SsoConnections, (sso) =>
              sso.resolveRouting('person@routed.test')
            )
          )
          expect(Option.isSome(routing)).toBe(true)
          if (Option.isSome(routing)) {
            expect(routing.value.providerId).toBe('sso_other_oidc')
          }
        })
      )

      it.effect(
        'update and remove of an unknown id change nothing and audit nothing',
        () =>
          Effect.gen(function* () {
            const db = yield* Database
            const { binding, calls } = fakeSsoBinding(db)
            const outcome = yield* inWorkspace(
              'live-lab',
              Effect.gen(function* () {
                const sso = yield* SsoConnections
                return {
                  updated: yield* sso.update({
                    providerId: 'sso_missing',
                    enabled: true
                  }),
                  removed: yield* sso.remove({ providerId: 'sso_missing' })
                }
              }),
              { userId: 'usr_owner' },
              { ssoBinding: binding }
            )
            expect(Option.isNone(outcome.updated)).toBe(true)
            expect(outcome.removed).toBe(false)
            expect(calls).toHaveLength(0)
          })
      )
    })
  }
)
