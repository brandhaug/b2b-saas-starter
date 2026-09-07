/* oxlint-disable effect/noGlobals -- fixed epoch dates required by Drizzle timestamp columns */
import { expect, layer } from '@effect/vitest'
import {
  passkey,
  user,
  workspaceMembers,
  workspaces,
  workspaceSsoConnections,
  workspaceSsoDomainClaims
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { eq } from 'drizzle-orm'
import { Effect, Option } from 'effect'

import { failureTag } from '../internal/failure-tag.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { SsoConnections } from './workspace-sso-connections.ts'

const owner = { userId: 'usr_owner', sessionId: 'ses_sso_owner' }
const setup = Effect.fn('test.setupSsoActivation')(function* (
  name: string,
  factor: boolean
) {
  const db = yield* Database
  yield* db.insert(workspaces).values({ id: name, slug: name, name })
  yield* db.insert(workspaceMembers).values({
    id: `${name}_owner`,
    workspaceId: name,
    userId: owner.userId,
    role: 'owner'
  })
  yield* db.insert(workspaceSsoConnections).values({
    id: name,
    providerId: name,
    workspaceId: name,
    userId: owner.userId,
    issuer: 'https://idp.example.test',
    domain: `${name}.test`,
    domainVerified: true,
    lastLoginTestedAt: new Date(0),
    lastLoginTestedBy: owner.userId
  })
  yield* db.insert(workspaceSsoDomainClaims).values({
    id: name,
    workspaceId: name,
    providerId: name,
    domain: `${name}.test`,
    verificationTokenHash: 'test-hash',
    status: 'verified',
    verifiedAt: '1970-01-01T00:00:00.000Z',
    lastCheckedAt: '1970-01-01T00:00:00.000Z',
    createdAt: '1970-01-01T00:00:00.000Z',
    updatedAt: '1970-01-01T00:00:00.000Z'
  })
  if (factor) {
    yield* db.insert(passkey).values({
      id: `${name}_passkey`,
      userId: owner.userId,
      credentialID: name,
      publicKey: 'test-key',
      counter: 0,
      deviceType: 'singleDevice',
      backedUp: false
    })
  }
})

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('SSO activation safety', (it) => {
  it.effect('retains workspace SSO when its original creator is deleted', () =>
    Effect.gen(function* () {
      yield* setup('creator-deletion', false)
      const db = yield* Database
      yield* db.insert(user).values({
        id: 'departing_creator',
        name: 'Former owner',
        email: 'former@example.test'
      })
      yield* db
        .update(workspaceSsoConnections)
        .set({ userId: 'departing_creator' })
        .where(eq(workspaceSsoConnections.providerId, 'creator-deletion'))
      yield* db.delete(user).where(eq(user.id, 'departing_creator'))
      const [connection] = yield* db
        .select()
        .from(workspaceSsoConnections)
        .where(eq(workspaceSsoConnections.providerId, 'creator-deletion'))
      expect(connection).toMatchObject({
        workspaceId: 'creator-deletion',
        providerId: 'creator-deletion',
        userId: null
      })
    })
  )
  it.effect('requires an independent owner recovery factor', () =>
    Effect.gen(function* () {
      yield* setup('no-factor', false)
      const result = yield* Effect.exit(
        inWorkspace(
          'no-factor',
          Effect.gen(function* () {
            return yield* (yield* SsoConnections).update({
              providerId: 'no-factor',
              enabled: true,
              requireSso: true,
              confirmEnforcement: true
            })
          }),
          owner
        )
      )
      expect(failureTag(result)).toBe('MembershipChangeRejected')
    })
  )

  it.effect(
    'requires explicit impact confirmation even for a verified and tested connection',
    () =>
      Effect.gen(function* () {
        yield* setup('no-confirmation', true)
        const result = yield* Effect.exit(
          inWorkspace(
            'no-confirmation',
            Effect.gen(function* () {
              return yield* (yield* SsoConnections).update({
                providerId: 'no-confirmation',
                enabled: true,
                requireSso: true
              })
            }),
            owner
          )
        )
        expect(failureTag(result)).toBe('MembershipChangeRejected')
      })
  )

  it.effect('activates a ready connection and refuses deletion while required', () =>
    Effect.gen(function* () {
      yield* setup('ready-connection', true)
      yield* inWorkspace(
        'ready-connection',
        Effect.gen(function* () {
          const sso = yield* SsoConnections
          const activated = yield* sso.update({
            providerId: 'ready-connection',
            enabled: true,
            requireSso: true,
            confirmEnforcement: true
          })
          expect(Option.getOrNull(activated)).toMatchObject({
            enabled: true,
            requireSso: true
          })
          expect(
            failureTag(
              yield* Effect.exit(sso.remove({ providerId: 'ready-connection' }))
            )
          ).toBe('MembershipChangeRejected')
        }),
        owner
      )
    })
  )

  it.effect(
    'atomically replaces required SSO and invalidates the retired generation',
    () =>
      Effect.gen(function* () {
        yield* setup('replacement', true)
        const db = yield* Database
        yield* db.insert(workspaceSsoConnections).values({
          id: 'predecessor',
          providerId: 'predecessor',
          workspaceId: 'replacement',
          userId: owner.userId,
          issuer: 'https://old.example.test',
          domain: 'replacement.test',
          enabled: true,
          requireSso: false,
          domainVerified: true,
          lastLoginTestedAt: new Date(0),
          lastLoginTestedBy: owner.userId
        })
        yield* inWorkspace(
          'replacement',
          Effect.gen(function* () {
            // Enable the old requirement after resolving this request's context.
            yield* db
              .update(workspaceSsoConnections)
              .set({ requireSso: true })
              .where(eq(workspaceSsoConnections.providerId, 'predecessor'))
            const sso = yield* SsoConnections
            const result = yield* sso.update({
              providerId: 'replacement',
              enabled: true,
              replaceProviderId: 'predecessor',
              confirmEnforcement: true
            })
            expect(Option.getOrNull(result)).toMatchObject({
              enabled: true,
              requireSso: true
            })
          }),
          owner
        )
        const [old] = yield* db
          .select()
          .from(workspaceSsoConnections)
          .where(eq(workspaceSsoConnections.providerId, 'predecessor'))
        expect(old).toMatchObject({
          enabled: false,
          requireSso: false,
          connectionGeneration: 2,
          lastLoginTestedAt: null
        })
      })
  )
})
