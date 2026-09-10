import {
  EmailDelivery,
  EmailDeliveryRecord
} from '@b2b-saas-starter/email-delivery/email-delivery'
import * as TestClock from 'effect/testing/TestClock'
import { AccountLifecycle } from './account-lifecycle.ts'
import { describe, expect, layer } from '@effect/vitest'
import { DateTime, Effect, Result, Schema } from 'effect'
import {
  account,
  notifications,
  oauthClient,
  oauthConsent,
  passkey,
  session,
  user,
  workspaceMembers
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { eq } from 'drizzle-orm'
import { PersonalDataExports } from './personal-data-export.ts'
import { PersonalDataExport } from './personal-data-export-archive.ts'
import { personalDataExportContractCases } from './personal-data-export.contract.ts'
import { AuditEventLog } from './audit-event-log.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'

const decodeArchive = Schema.decodeUnknownSync(
  Schema.fromJsonString(PersonalDataExport)
)

const decodeEmailArchive = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ emailDeliveries: Schema.Array(EmailDeliveryRecord) })
  )
)

const addSession = Effect.fn('test.addExportSession')(function* (
  userId: string,
  id: string
) {
  const db = yield* Database
  const now = yield* DateTime.now
  yield* db.insert(session).values({
    id,
    userId,
    token: `secret-${id}`,
    expiresAt: DateTime.toDate(DateTime.add(now, { days: 2 })),
    passwordVerifiedAt: DateTime.toDate(now)
  })
})

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'personal data export Live',
  (it) => {
    // The Seed half of this same list runs in
    // `personal-data-export.seed.test.ts`. Its subject is planted here
    // rather than by the shared harness: only this suite needs the five
    // account tables filled, and a row in `oauth_client` or `passkey` would
    // otherwise show up in every other live suite's reads.
    describe('live personal data export contract', () => {
      const plantContractSubject = Effect.gen(function* () {
        const db = yield* Database
        yield* db
          .insert(user)
          .values({
            id: 'usr_pde',
            name: 'Export Subject',
            email: 'subject@live-export.test'
          })
          .onConflictDoNothing()
        yield* db
          .insert(workspaceMembers)
          .values({
            id: 'mem_pde',
            workspaceId: 'wrk_live',
            userId: 'usr_pde',
            role: 'member'
          })
          .onConflictDoNothing()
        yield* db
          .insert(notifications)
          .values({
            id: 'not_pde',
            workspaceId: 'wrk_live',
            userId: 'usr_pde',
            kind: 'announcement',
            createdAt: '2026-09-01T00:00:00.000Z',
            title: 'Subject notice',
            message: 'For the export subject'
          })
          .onConflictDoNothing()
        yield* db
          .insert(oauthClient)
          .values({
            id: 'oac_pde',
            clientId: 'pde-client',
            userId: 'usr_pde',
            clientSecret: 'pde-private-client-secret',
            name: 'Subject MCP client',
            redirectUris: ['http://localhost/callback'],
            scopes: ['openid']
          })
          .onConflictDoNothing()
        yield* db
          .insert(oauthConsent)
          .values({
            id: 'con_pde',
            userId: 'usr_pde',
            clientId: 'pde-client',
            referenceId: 'wrk_live',
            scopes: ['openid']
          })
          .onConflictDoNothing()
        yield* db
          .insert(account)
          .values({
            id: 'acc_pde',
            userId: 'usr_pde',
            accountId: 'pde-provider-account',
            providerId: 'test-provider',
            issuer: 'https://provider.example',
            password: 'pde-private-password-hash'
          })
          .onConflictDoNothing()
        yield* db
          .insert(passkey)
          .values({
            id: 'pky_pde',
            userId: 'usr_pde',
            publicKey: 'pde-private-public-key',
            credentialID: 'pde-credential',
            deviceType: 'singleDevice',
            backedUp: false,
            counter: 1
          })
          .onConflictDoNothing()
        for (const id of ['pde-session', 'pde-other-session']) {
          yield* Effect.ignore(addSession('usr_pde', id))
        }
        yield* Effect.ignore(addSession('usr_owner', 'pde-owner-session'))
      })

      const cases = personalDataExportContractCases(
        {
          userId: 'usr_pde',
          sessionId: 'pde-session',
          otherSessionId: 'pde-other-session',
          otherUser: { userId: 'usr_owner', sessionId: 'pde-owner-session' },
          unknownUserId: 'usr_never_existed',
          expected: {
            workspaceIds: ['wrk_live'],
            notifications: [{ id: 'not_pde', workspaceId: 'wrk_live' }],
            sessionIds: ['pde-session', 'pde-other-session'],
            linkedAccountIds: ['acc_pde'],
            oauthClientIds: ['pde-client'],
            oauthConsentIds: ['con_pde'],
            passkeyIds: ['pky_pde']
          },
          secrets: [
            'pde-private-client-secret',
            'pde-private-password-hash',
            'pde-private-public-key',
            'secret-pde-session'
          ]
        },
        expect
      )
      for (const contractCase of cases) {
        it.effect(contractCase.name, () =>
          Effect.flatMap(plantContractSubject, () =>
            inWorkspace('live-lab', contractCase.assert)
          )
        )
      }
    })

    it.effect(
      'includes all personal email evidence beyond the history page without send credentials',
      () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const delivery = yield* EmailDelivery
            for (let index = 0; index < 101; index += 1) {
              let workspaceId = 'wrk_live'
              if (index === 0) {
                workspaceId = 'wrk_other'
              }
              yield* delivery.claim({
                id: `personal-email-${index}`,
                userId: 'usr_audited',
                recipient: 'audited@live.test',
                workspaceId,
                purpose: 'notification'
              })
            }
            const foreignClaim = yield* delivery.claim({
              id: 'foreign-personal-email',
              userId: 'usr_owner',
              recipient: 'private-recipient@example.com',
              workspaceId: 'wrk_live',
              purpose: 'notification'
            })
            const privateClaim = yield* delivery.claim({
              id: 'personal-email-secret',
              userId: 'usr_audited',
              recipient: 'audited@live.test',
              workspaceId: 'wrk_live',
              purpose: 'notification'
            })
            expect(privateClaim).not.toBeNull()
            expect(foreignClaim).not.toBeNull()
            yield* addSession('usr_audited', 'personal-email-session')
            const exports = yield* PersonalDataExports
            const receipt = yield* exports.request(
              'usr_audited',
              'personal-email-session'
            )
            const download = yield* exports.download(
              'usr_audited',
              'personal-email-session',
              receipt.id
            )
            const archive = decodeEmailArchive(download.json)
            expect(archive.emailDeliveries).toHaveLength(102)
            expect(archive.emailDeliveries).toContainEqual(
              expect.objectContaining({
                id: 'personal-email-0',
                workspaceId: 'wrk_other',
                recipient: 'audited@live.test'
              })
            )
            expect(download.json).not.toContain('private-recipient@example.com')
            if (privateClaim !== null) {
              expect(download.json).not.toContain(privateClaim.token)
            }
            expect(yield* delivery.listForUser('usr_audited')).toHaveLength(100)
          })
        ),
      // Creating 102 live delivery records serially can exceed Vitest's
      // default test budget on a contended CI runner.
      { timeout: 60_000 }
    )

    it.effect(
      'exports only the requester across shared and separate workspaces with nonsecret OAuth metadata',
      () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const db = yield* Database
            yield* db.insert(workspaceMembers).values([
              {
                id: 'export_alice_shared',
                workspaceId: 'wrk_live',
                userId: 'usr_alice',
                role: 'member'
              },
              {
                id: 'export_bob_shared',
                workspaceId: 'wrk_live',
                userId: 'usr_bob',
                role: 'member'
              },
              {
                id: 'export_alice_private',
                workspaceId: 'wrk_other',
                userId: 'usr_alice',
                role: 'owner'
              },
              {
                id: 'export_bob_private',
                workspaceId: 'wrk_audit',
                userId: 'usr_bob',
                role: 'owner'
              }
            ])
            yield* db.insert(notifications).values([
              {
                id: 'export_alice_notice',
                workspaceId: 'wrk_live',
                userId: 'usr_alice',
                kind: 'announcement',
                createdAt: '2026-09-01T00:00:00.000Z',
                title: 'Alice notice',
                message: 'For Alice'
              },
              {
                id: 'export_alice_other',
                workspaceId: 'wrk_other',
                userId: 'usr_alice',
                kind: 'announcement',
                createdAt: '2026-09-01T00:00:00.000Z',
                title: 'Alice private notice',
                message: 'Also for Alice'
              },
              {
                id: 'export_bob_notice',
                workspaceId: 'wrk_live',
                userId: 'usr_bob',
                kind: 'announcement',
                createdAt: '2026-09-01T00:00:00.000Z',
                title: 'Bob notice',
                message: 'Private Bob message'
              }
            ])
            yield* db.insert(oauthClient).values([
              {
                id: 'export_alice_client',
                clientId: 'alice-client',
                userId: 'usr_alice',
                clientSecret: 'private-client-secret',
                name: 'Alice MCP client',
                redirectUris: ['http://localhost/callback'],
                scopes: ['openid']
              },
              {
                id: 'export_bob_client',
                clientId: 'bob-client',
                userId: 'usr_bob',
                clientSecret: 'bob-secret',
                name: 'Private Bob client',
                redirectUris: ['http://localhost/callback']
              }
            ])
            yield* db.insert(oauthConsent).values([
              {
                id: 'export_alice_consent',
                userId: 'usr_alice',
                clientId: 'alice-client',
                referenceId: 'wrk_live',
                scopes: ['openid', 'workspace:read']
              },
              {
                id: 'export_bob_consent',
                userId: 'usr_bob',
                clientId: 'bob-client',
                referenceId: 'wrk_live',
                scopes: ['openid']
              }
            ])
            yield* db.insert(account).values({
              id: 'export_alice_account',
              userId: 'usr_alice',
              accountId: 'alice-provider-account',
              providerId: 'test-provider',
              issuer: 'https://provider.example',
              password: 'private-password-hash',
              accessToken: 'private-access-token',
              refreshToken: 'private-refresh-token'
            })
            yield* db.insert(passkey).values({
              id: 'export_alice_passkey',
              userId: 'usr_alice',
              publicKey: 'private-public-key',
              credentialID: 'alice-credential',
              deviceType: 'singleDevice',
              backedUp: false,
              counter: 7
            })
            yield* addSession('usr_alice', 'export-alice-session')
            yield* addSession('usr_bob', 'export-bob-session')
            const exports = yield* PersonalDataExports
            const receipt = yield* exports.request('usr_alice', 'export-alice-session')
            const download = yield* exports.download(
              'usr_alice',
              'export-alice-session',
              receipt.id
            )
            const data = decodeArchive(download.json)
            expect(data.user.id).toBe('usr_alice')
            expect(data.workspaces.map((row) => row.workspace.id).toSorted()).toEqual([
              'wrk_live',
              'wrk_other'
            ])
            expect(data.notifications.map((row) => row.id).toSorted()).toEqual([
              'export_alice_notice',
              'export_alice_other'
            ])
            expect(data.oauthClients).toEqual([
              expect.objectContaining({
                clientId: 'alice-client',
                name: 'Alice MCP client'
              })
            ])
            expect(data.oauthConsents).toEqual([
              expect.objectContaining({
                referenceId: 'wrk_live',
                scopes: ['openid', 'workspace:read']
              })
            ])
            expect(data.linkedAccounts).toEqual([
              expect.objectContaining({ accountId: 'alice-provider-account' })
            ])
            expect(data.passkeys).toEqual([
              expect.objectContaining({ credentialID: 'alice-credential' })
            ])
            for (const secret of [
              'bob@live.test',
              'Private Bob',
              'private-client-secret',
              'private-password-hash',
              'private-access-token',
              'private-refresh-token',
              'private-public-key',
              'secret-export-alice-session'
            ]) {
              expect(download.json).not.toContain(secret)
            }
            expect(
              Result.isFailure(
                yield* Effect.result(exports.request('usr_bob', 'export-alice-session'))
              )
            ).toBe(true)
            const bobReceipt = yield* exports.request('usr_bob', 'export-bob-session')
            const bob = decodeArchive(
              (yield* exports.download('usr_bob', 'export-bob-session', bobReceipt.id))
                .json
            )
            expect(bob.workspaces.map((row) => row.workspace.id).toSorted()).toEqual([
              'wrk_audit',
              'wrk_live'
            ])
            expect(bob.notifications.map((row) => row.id)).toEqual([
              'export_bob_notice'
            ])
            expect(
              Result.isFailure(
                yield* Effect.result(
                  exports.download('usr_bob', 'export-bob-session', receipt.id)
                )
              )
            ).toBe(true)
            const audit = yield* AuditEventLog
            const events = yield* audit.listGlobal
            expect(
              events.filter(
                (event) =>
                  event.eventType === 'auth.personal_data_exported' &&
                  event.actor === 'Alice'
              )
            ).toHaveLength(2)
          })
        )
    )
    it.effect(
      'exports an empty account, expires the artifact, and lets a later request succeed',
      () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const exports = yield* PersonalDataExports
            yield* addSession('usr_joiner', 'export-empty-session')
            const receipt = yield* exports.request('usr_joiner', 'export-empty-session')
            const empty = decodeArchive(
              (yield* exports.download(
                'usr_joiner',
                'export-empty-session',
                receipt.id
              )).json
            )
            expect(empty.user.id).toBe('usr_joiner')
            expect(empty.workspaces).toEqual([])
            expect(empty.notifications).toEqual([])
            expect(empty.oauthClients).toEqual([])
            expect(empty.oauthConsents).toEqual([])
            expect(empty.passkeys).toEqual([])
            yield* TestClock.adjust('24 hours')
            expect(
              Result.isFailure(
                yield* Effect.result(
                  exports.download('usr_joiner', 'export-empty-session', receipt.id)
                )
              )
            ).toBe(true)
            const replacement = yield* exports.request(
              'usr_joiner',
              'export-empty-session'
            )
            expect(replacement.id).not.toBe(receipt.id)
            expect(
              decodeArchive(
                (yield* exports.download(
                  'usr_joiner',
                  'export-empty-session',
                  replacement.id
                )).json
              ).user.id
            ).toBe('usr_joiner')
          })
        )
    )

    it.effect(
      'binds the artifact to its session and removes access when that session is revoked',
      () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const db = yield* Database
            const exports = yield* PersonalDataExports
            yield* addSession('usr_mover', 'export-original-session')
            yield* addSession('usr_mover', 'export-other-session')
            const receipt = yield* exports.request(
              'usr_mover',
              'export-original-session'
            )
            expect(
              Result.isFailure(
                yield* Effect.result(
                  exports.download('usr_mover', 'export-other-session', receipt.id)
                )
              )
            ).toBe(true)
            yield* db.delete(session).where(eq(session.id, 'export-original-session'))
            expect(
              Result.isFailure(
                yield* Effect.result(
                  exports.download('usr_mover', 'export-original-session', receipt.id)
                )
              )
            ).toBe(true)
            expect(
              Result.isFailure(
                yield* Effect.result(
                  exports.request('usr_mover', 'export-original-session')
                )
              )
            ).toBe(true)
            yield* addSession('usr_mover', 'export-original-session')
            expect(
              Result.isFailure(
                yield* Effect.result(
                  exports.download('usr_mover', 'export-original-session', receipt.id)
                )
              )
            ).toBe(true)
          })
        )
    )

    it.effect(
      'account deletion removes the archive permanently even if the identity is recreated',
      () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            const db = yield* Database
            const exports = yield* PersonalDataExports
            yield* db.insert(user).values({
              id: 'export-deleted-user',
              name: 'Deleted User',
              email: 'deleted-export@example.com'
            })
            yield* addSession('export-deleted-user', 'export-deleted-session')
            const receipt = yield* exports.request(
              'export-deleted-user',
              'export-deleted-session'
            )
            const lifecycle = yield* AccountLifecycle
            yield* lifecycle.prepareDeletion('export-deleted-user')
            yield* db.delete(user).where(eq(user.id, 'export-deleted-user'))
            expect(
              Result.isFailure(
                yield* Effect.result(
                  exports.download(
                    'export-deleted-user',
                    'export-deleted-session',
                    receipt.id
                  )
                )
              )
            ).toBe(true)
            yield* db.insert(user).values({
              id: 'export-deleted-user',
              name: 'Recreated User',
              email: 'recreated-export@example.com'
            })
            yield* addSession('export-deleted-user', 'export-deleted-session')
            expect(
              Result.isFailure(
                yield* Effect.result(
                  exports.download(
                    'export-deleted-user',
                    'export-deleted-session',
                    receipt.id
                  )
                )
              )
            ).toBe(true)
          })
        )
    )
  }
)
