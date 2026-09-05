import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import { CapabilityUnavailable, MembershipChangeRejected } from '../errors.ts'
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
      it.effect('adds a member through the binding and audits it', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const { binding, calls } = fakeMemberBinding(db)
          const added = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const membership = yield* WorkspaceMembership
              return yield* membership.addMember({
                userId: 'usr_audited',
                role: 'member'
              })
            }),
            { userId: 'usr_owner' },
            { memberBinding: binding }
          )

          // The binding is called with the workspace resolved from context, never
          // a slug or a caller-supplied id.
          expect(calls).toEqual([
            { workspaceId: 'wrk_live', userId: 'usr_audited', role: 'member' }
          ])
          // The returned DTO is read back from D1, so it carries the joined user
          // identity rather than echoing the input.
          expect(added.id).toBe('usr_audited')
          expect(added.email).toBe('audited@live.test')
          expect(added.role).toBe('member')

          const events = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const audit = yield* AuditEventLog
              return (yield* audit.list()).events
            }),
            { userId: 'usr_owner' }
          )
          expect(events.map((event) => event.eventType)).toContain(
            'workspace_member.added'
          )
        })
      )

      it.effect('changes a role and removes a member, addressing them by row id', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const { binding, calls } = fakeMemberBinding(db)
          function run<A, E>(
            effect: Effect.Effect<A, E, WorkspaceContext | CapabilityServices>
          ) {
            return inWorkspace(
              'live-lab',
              effect,
              { userId: 'usr_owner' },
              {
                memberBinding: binding
              }
            )
          }

          yield* run(
            Effect.gen(function* () {
              const membership = yield* WorkspaceMembership
              return yield* membership.addMember({
                userId: 'usr_mover',
                role: 'member'
              })
            })
          )

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
            { workspaceId: 'wrk_live', userId: 'usr_mover', role: 'member' },
            { workspaceId: 'wrk_live', memberId: 'mem_usr_mover', role: 'admin' },
            { workspaceId: 'wrk_live', memberId: 'mem_usr_mover' }
          ])

          const events = yield* run(
            Effect.gen(function* () {
              const audit = yield* AuditEventLog
              return (yield* audit.list()).events
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
          // A plain member to act as, minted by this case so it leans on no
          // other case's roster state. The route gate would already deny them
          // `member:update`; this asserts the capability's own rule for the
          // change the permission matrix cannot see coming — an admin may
          // hold `member:update` and still not touch an owner's role.
          yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const membership = yield* WorkspaceMembership
              return yield* membership.addMember({
                userId: 'usr_mover',
                role: 'member'
              })
            }),
            { userId: 'usr_owner' },
            { memberBinding: binding }
          )
          const callsBefore = calls.length
          const error = yield* Effect.flip(
            inWorkspace(
              'live-lab',
              Effect.gen(function* () {
                const membership = yield* WorkspaceMembership
                return yield* membership.changeRole({
                  userId: 'usr_owner',
                  role: 'admin'
                })
              }),
              { userId: 'usr_mover' },
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
            // `other-lab` starts empty, so the two owners are minted actorless —
            // the context resolves membership before the effect runs, and
            // `usr_owner` becomes addressable there only after the add. Using a
            // second workspace leaves `live-lab` exactly as the suites after it
            // expect it (`usr_owner` still its sole owner), and `usr_bob` — a
            // fixture account no other suite gives a member row — keeps the
            // fake's `mem_<user>` surrogate ids from colliding with the
            // contract's own inserts below.
            yield* inWorkspace(
              'other-lab',
              Effect.gen(function* () {
                const membership = yield* WorkspaceMembership
                yield* membership.addMember({ userId: 'usr_owner', role: 'owner' })
                yield* membership.addMember({ userId: 'usr_bob', role: 'owner' })
              }),
              undefined,
              { memberBinding: binding }
            )
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
            expect(calls).toEqual([
              { workspaceId: 'wrk_other', userId: 'usr_owner', role: 'owner' },
              { workspaceId: 'wrk_other', userId: 'usr_bob', role: 'owner' },
              { workspaceId: 'wrk_other' }
            ])
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
                return (yield* audit.list()).events
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
              'live-lab',
              Effect.gen(function* () {
                const membership = yield* WorkspaceMembership
                return yield* membership.addMember({
                  userId: 'usr_joiner',
                  role: 'member'
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
      const cases = workspaceMembershipContractCases(
        { member: 'usr_owner', newcomer: 'usr_joiner', stranger: 'usr_outsider' },
        expect
      )
      for (const contractCase of cases) {
        it.effect(contractCase.name, () =>
          Effect.gen(function* () {
            const db = yield* Database
            const { binding } = fakeMemberBinding(db)
            yield* inWorkspace(
              'live-lab',
              contractCase.assert,
              { userId: 'usr_owner' },
              { memberBinding: binding }
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
