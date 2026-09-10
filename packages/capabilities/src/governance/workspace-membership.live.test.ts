import { workspaceMembers } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import { MembershipChangeRejected } from '../errors.ts'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type CapabilityServices } from '../layers.ts'
import {
  fakeMemberBinding,
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { type WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { WorkspaceMembership } from './workspace-membership.ts'
import { workspaceMembershipContractCases } from './workspace-membership.contract.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live workspace membership',
  (it) => {
    describe('live workspace membership mutations', () => {
      it.effect('changes a role and removes a member, addressing them by row id', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const { binding, calls } = fakeMemberBinding(db)
          function run<A, E>(
            effect: Effect.Effect<A, E, WorkspaceContext | CapabilityServices>
          ) {
            return inWorkspace(
              'member-contract-lab',
              effect,
              { userId: 'usr_owner' },
              {
                memberBinding: binding
              }
            )
          }

          // `usr_mover` is a seeded plain member of `member-contract-lab`:
          // membership has no add verb, so the roster a case mutates comes
          // from the fixture. Not `live-lab`, whose member count is the seat
          // quantity a billing suite asserts on.
          const promoted = yield* run(
            Effect.gen(function* () {
              const membership = yield* WorkspaceMembership
              return yield* membership.changeRole({
                userId: 'usr_mover',
                role: 'admin'
              })
            })
          )
          expect(promoted.role).toBe('admin')

          yield* run(
            Effect.gen(function* () {
              const membership = yield* WorkspaceMembership
              return yield* membership.removeMember({ userId: 'usr_mover' })
            })
          )

          const remaining = yield* run(
            Effect.gen(function* () {
              const membership = yield* WorkspaceMembership
              return yield* membership.listMembers
            })
          )
          expect(remaining.map((member) => member.id)).not.toContain('usr_mover')

          // The plugin addresses members by their surrogate row id, so the
          // capability must resolve the user id to one before calling out.
          expect(calls).toEqual([
            {
              workspaceId: 'wrk_member_contract',
              memberId: 'mem_mc_mover',
              role: 'admin'
            },
            { workspaceId: 'wrk_member_contract', memberId: 'mem_mc_mover' }
          ])

          const events = yield* run(
            Effect.gen(function* () {
              const audit = yield* AuditEventLog
              return (yield* audit.list()).items
            })
          )
          const types = events.map((event) => event.eventType)
          expect(types).toContain('workspace_member.role_changed')
          expect(types).toContain('workspace_member.removed')
        })
      )

      it.effect('rejects a mutation naming someone who is not a member', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const { binding, calls } = fakeMemberBinding(db)
          const error = yield* Effect.flip(
            inWorkspace(
              'live-lab',
              Effect.gen(function* () {
                const membership = yield* WorkspaceMembership
                return yield* membership.removeMember({ userId: 'usr_outsider' })
              }),
              { userId: 'usr_owner' },
              { memberBinding: binding }
            )
          )
          expect(error).toBeInstanceOf(MembershipChangeRejected)
          // Rejected before the plugin is touched: no row id to address it with.
          expect(calls).toEqual([])
        })
      )

      it.effect('refuses the sole owner leaving without asking the binding', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const { binding, calls } = fakeMemberBinding(db)
          const error = yield* Effect.flip(
            inWorkspace(
              'live-lab',
              Effect.gen(function* () {
                const membership = yield* WorkspaceMembership
                return yield* membership.leave
              }),
              { userId: 'usr_owner' },
              { memberBinding: binding }
            )
          )
          expect(error).toBeInstanceOf(MembershipChangeRejected)
          expect(error instanceof MembershipChangeRejected && error.reason).toBe(
            'sole_owner'
          )
          // The rule refused, so the plugin never heard about it.
          expect(calls).toEqual([])
        })
      )

      it.effect('refuses an owner-role change from a non-owner actor', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const { binding, calls } = fakeMemberBinding(db)
          // `usr_bystander` is a plain member no case spends, so acting as
          // them leans on no other case's roster state. The route gate would
          // already deny them `member:update`; this asserts the capability's
          // own rule for the change the permission matrix cannot see coming —
          // an admin may hold `member:update` and still not touch an owner's
          // role.
          const callsBefore = calls.length
          const error = yield* Effect.flip(
            inWorkspace(
              'member-contract-lab',
              Effect.gen(function* () {
                const membership = yield* WorkspaceMembership
                return yield* membership.changeRole({
                  userId: 'usr_owner',
                  role: 'admin'
                })
              }),
              { userId: 'usr_bystander' },
              { memberBinding: binding }
            )
          )
          expect(error).toBeInstanceOf(MembershipChangeRejected)
          expect(error instanceof MembershipChangeRejected && error.reason).toBe(
            'owner_requires_owner'
          )
          expect(calls).toHaveLength(callsBefore)
        })
      )

      it.effect(
        'leaves through the session-bound endpoint once another owner remains',
        () =>
          Effect.gen(function* () {
            const db = yield* Database
            const { binding, calls } = fakeMemberBinding(db)
            // `other-lab` starts empty, so this case seeds its own two owners
            // straight into D1 — membership has no add verb, and the plugin
            // that would grant one is not what this case is about. Using a
            // second workspace leaves `live-lab` exactly as the suites after
            // it expect it (`usr_owner` still its sole owner).
            yield* db.insert(workspaceMembers).values([
              {
                id: 'mem_other_owner',
                workspaceId: 'wrk_other',
                userId: 'usr_owner',
                role: 'owner'
              },
              {
                id: 'mem_other_bob',
                workspaceId: 'wrk_other',
                userId: 'usr_bob',
                role: 'owner'
              }
            ])
            yield* inWorkspace(
              'other-lab',
              Effect.gen(function* () {
                const membership = yield* WorkspaceMembership
                return yield* membership.leave
              }),
              { userId: 'usr_owner' },
              { memberBinding: binding }
            )
            // The leave endpoint is addressed by workspace only — the plugin
            // resolves the member from the session, which the fake mirrors.
            expect(calls).toEqual([{ workspaceId: 'wrk_other' }])
            const remaining = yield* inWorkspace(
              'other-lab',
              Effect.gen(function* () {
                const membership = yield* WorkspaceMembership
                return yield* membership.listMembers
              }),
              { userId: 'usr_bob' }
            )
            expect(remaining.map((member) => member.id)).toEqual(['usr_bob'])
            const events = yield* inWorkspace(
              'other-lab',
              Effect.gen(function* () {
                const audit = yield* AuditEventLog
                return (yield* audit.list()).items
              }),
              { userId: 'usr_bob' }
            )
            expect(events.map((event) => event.eventType)).toContain(
              'workspace_member.removed'
            )
          })
      )

      it.effect('fails as unavailable when no binding is configured', () =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            inWorkspace(
              'member-contract-lab',
              Effect.gen(function* () {
                const membership = yield* WorkspaceMembership
                return yield* membership.changeRole({
                  userId: 'usr_bystander',
                  role: 'admin'
                })
              }),
              { userId: 'usr_owner' }
            )
          )
          expect(error).toBeInstanceOf(CapabilityUnavailable)
          expect(error instanceof CapabilityUnavailable && error.reason).toBe(
            'no_member_binding'
          )
        })
      )
    })

    // The Seed half of this same list runs in index.test.ts.
    describe('live workspace membership contract', () => {
      // The deployment's evidence sink, as a recording stand-in — the same
      // seam `apps/web` fills with the real one.
      const evidence: Array<{ kind: string; subjectId: string }> = []
      const evidenceSink = {
        append: (record: { kind: string; subjectId: string }) => {
          evidence.push({ kind: record.kind, subjectId: record.subjectId })
          return Promise.resolve()
        },
        reportGap: () => Promise.resolve()
      }
      const cases = workspaceMembershipContractCases(
        {
          member: 'usr_owner',
          removable: 'usr_removable',
          mutable: 'usr_mutable',
          auditable: 'usr_auditable',
          stranger: 'usr_outsider',
          recordedEvidence: Effect.sync(() => [...evidence])
        },
        expect
      )
      for (const contractCase of cases) {
        it.effect(contractCase.name, () =>
          Effect.gen(function* () {
            const db = yield* Database
            const { binding } = fakeMemberBinding(db)
            // Its own workspace, like the developer-platform and user-admin
            // contracts: the cases spend members out of the roster, so they
            // must not share one with the mutation suite above.
            yield* inWorkspace(
              'member-contract-lab',
              contractCase.assert,
              { userId: 'usr_owner' },
              { memberBinding: binding, securityEvidence: evidenceSink }
            )
          })
        )
      }
    })

    describe('live workspace membership projection', () => {
      it.effect('lists memberships for a member and nothing for an outsider', () =>
        Effect.gen(function* () {
          const memberships = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const membership = yield* WorkspaceMembership
              return {
                forOwner: yield* membership.listWorkspacesForUser('usr_owner'),
                forOutsider: yield* membership.listWorkspacesForUser('usr_outsider')
              }
            })
          )
          expect(memberships.forOwner.map((entry) => entry.workspace.slug)).toContain(
            'live-lab'
          )
          expect(memberships.forOutsider).toEqual([])
        })
      )
    })
  }
)
