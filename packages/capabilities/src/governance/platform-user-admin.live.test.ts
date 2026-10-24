import { Database } from '@b2b-saas-starter/db/service'
import { workspaceMembers } from '@b2b-saas-starter/db/schema'
import { eq } from 'drizzle-orm'
import { Effect, Layer } from 'effect'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { SeedLayer } from '../layers.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { LivePlatformUserAdmin } from './platform-user-admin.live.ts'
import { describe, expect, layer } from '@effect/vitest'

import {
  fakeUserAdminBinding,
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import {
  platformUserAdminContractCases,
  platformUserAdminRecoveryContract
} from './platform-user-admin.contract.ts'
import { PlatformUserAdmin } from './platform-user-admin.ts'
import {
  type SecurityEvidenceRecord,
  type SecurityEvidenceGap
} from './security-recovery-evidence.ts'

// Role-change cases promote and demote their target. Keep another owner so
// these changes remain legal regardless of the previous case's target role.
const UserAdminDatabase = Layer.effectDiscard(
  Effect.gen(function* () {
    const db = yield* Database
    yield* db.insert(workspaceMembers).values({
      id: 'mem_uac_stable_owner',
      workspaceId: 'wrk_user_admin_contract',
      userId: 'usr_sysadmin',
      role: 'owner'
    })
  })
).pipe(Layer.provideMerge(TestDatabase))

// The Seed half of this same list runs in index.test.ts.
layer(UserAdminDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live platform user admin',
  (it) => {
    it.effect(
      'records completed admin changes through the configured live evidence sink',
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          const records: Array<SecurityEvidenceRecord> = []
          yield* inWorkspace(
            'live-lab',
            platformUserAdminRecoveryContract(
              {
                existing: 'usr_owner',
                outsider: 'usr_outsider',
                unknown: 'usr_nobody',
                workspaceId: 'wrk_user_admin_contract',
                admin: 'usr_sysadmin'
              },
              records,
              'live',
              expect
            ),
            { userId: 'usr_owner' },
            {
              userAdminBinding: fakeUserAdminBinding(db),
              securityEvidence: {
                append: (record) => {
                  records.push(record)
                  return Promise.resolve()
                },
                reportGap: () => Promise.resolve()
              }
            }
          )
        })
    )

    // Failure modes: plugin refusal must not emit; a completed write must emit
    // before readback can fail; sink failure must report a gap without undoing it.
    it.effect('persists evidence before attempting a failing audit write', () =>
      Effect.gen(function* () {
        const db = yield* Database
        const order: Array<string> = []
        const adminLayer = LivePlatformUserAdmin(fakeUserAdminBinding(db), {
          append: (record) => {
            order.push(record.kind)
            return Promise.resolve()
          },
          reportGap: () => Promise.resolve()
        }).pipe(
          Layer.provide(
            Layer.mock(AuditEventLog, {
              record: () =>
                Effect.gen(function* () {
                  order.push('audit')
                  return yield* Effect.fail(
                    new CapabilityUnavailable({
                      capability: 'audit-event-log',
                      reason: 'test_audit_failure'
                    })
                  )
                })
            })
          ),
          Layer.provide(SeedLayer)
        )
        yield* Effect.gen(function* () {
          const admin = yield* PlatformUserAdmin
          yield* admin.banUser({ userId: 'usr_owner', actorUserId: null })
          yield* admin.changeWorkspaceRole({
            userId: 'usr_owner',
            workspaceId: 'wrk_user_admin_contract',
            role: 'member',
            actorUserId: null
          })
          expect(order).toEqual([
            'account_banned',
            'audit',
            'workspace_access_removed',
            'audit'
          ])
        }).pipe(Effect.provide(adminLayer))
      })
    )

    it.effect(
      'does not emit evidence when a binding refuses a ban or role change',
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          const records: Array<SecurityEvidenceRecord> = []
          function refuse() {
            return Promise.reject(new Error('binding refused'))
          }
          yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const admin = yield* PlatformUserAdmin
              expect(
                (yield* Effect.exit(
                  admin.banUser({ userId: 'usr_owner', actorUserId: null })
                ))._tag
              ).toBe('Failure')
              expect(
                (yield* Effect.exit(
                  admin.changeWorkspaceRole({
                    userId: 'usr_owner',
                    workspaceId: 'wrk_user_admin_contract',
                    role: 'member',
                    actorUserId: null
                  })
                ))._tag
              ).toBe('Failure')
              expect(records).toEqual([])
            }),
            { userId: 'usr_owner' },
            {
              userAdminBinding: {
                ...fakeUserAdminBinding(db),
                banUser: refuse,
                setMemberRole: refuse
              },
              securityEvidence: {
                append: (record) => {
                  records.push(record)
                  return Promise.resolve()
                },
                reportGap: () => Promise.resolve()
              }
            }
          )
        })
    )

    it.effect(
      'keeps role evidence when the successful binding loses its readback row',
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(workspaceMembers).values({
            id: 'mem_readback',
            workspaceId: 'wrk_user_admin_contract',
            userId: 'usr_outsider',
            role: 'owner'
          })
          const records: Array<SecurityEvidenceRecord> = []
          yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const admin = yield* PlatformUserAdmin
              const error = yield* Effect.flip(
                admin.changeWorkspaceRole({
                  userId: 'usr_outsider',
                  workspaceId: 'wrk_user_admin_contract',
                  role: 'member',
                  actorUserId: null
                })
              )
              expect(error._tag).toBe('UserAdminRejected')
              expect(records).toMatchObject([
                {
                  kind: 'workspace_access_removed',
                  subjectId: 'usr_outsider',
                  workspaceId: 'wrk_user_admin_contract'
                }
              ])
            }),
            { userId: 'usr_owner' },
            {
              userAdminBinding: {
                ...fakeUserAdminBinding(db),
                setMemberRole: () =>
                  // oxlint-disable-next-line starter/no-run-promise-in-tests -- bridges the Promise-returning admin plugin binding to the isolated D1 adapter
                  Effect.runPromise(
                    Effect.asVoid(
                      db
                        .delete(workspaceMembers)
                        .where(eq(workspaceMembers.id, 'mem_readback'))
                    )
                  )
              },
              securityEvidence: {
                append: (record) => {
                  records.push(record)
                  return Promise.resolve()
                },
                reportGap: () => Promise.resolve()
              }
            }
          )
        })
    )

    it.effect(
      'reports evidence gaps without undoing completed bans or role changes',
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          const gaps: Array<SecurityEvidenceGap> = []
          yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const admin = yield* PlatformUserAdmin
              yield* admin.banUser({ userId: 'usr_owner', actorUserId: null })
              const member = yield* admin.changeWorkspaceRole({
                userId: 'usr_owner',
                workspaceId: 'wrk_user_admin_contract',
                role: 'member',
                actorUserId: null
              })
              expect(member.role).toBe('member')
              expect(
                (yield* admin.listUsers).find((user) => user.id === 'usr_owner')?.banned
              ).toBe(true)
              expect(gaps.map((gap) => gap.kind)).toEqual([
                'account_banned',
                'workspace_access_removed'
              ])
              yield* admin.unbanUser({ userId: 'usr_owner', actorUserId: null })
            }),
            { userId: 'usr_owner' },
            {
              userAdminBinding: fakeUserAdminBinding(db),
              securityEvidence: {
                append: () => Promise.reject(new Error('evidence offline')),
                reportGap: (gap) => {
                  gaps.push(gap)
                  return Promise.resolve()
                }
              }
            }
          )
        })
    )
    describe('live platform user admin contract', () => {
      for (const contractCase of platformUserAdminContractCases(
        {
          existing: 'usr_owner',
          outsider: 'usr_outsider',
          unknown: 'usr_nobody',
          workspaceId: 'wrk_user_admin_contract',
          admin: 'usr_sysadmin'
        },
        expect
      )) {
        it.effect(contractCase.name, () =>
          Effect.gen(function* () {
            const db = yield* Database
            const binding = fakeUserAdminBinding(db)
            yield* inWorkspace(
              'live-lab',
              contractCase.assert,
              { userId: 'usr_owner' },
              { userAdminBinding: binding }
            )
          })
        )
      }
    })
  }
)
