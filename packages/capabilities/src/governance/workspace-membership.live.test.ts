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
