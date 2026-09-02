import { Database } from '@b2b-saas-starter/db/service'
import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import { CapabilityUnavailable } from '../errors.ts'
import {
  fakeInvitationBinding,
  fakeMemberBinding,
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { WorkspaceInvitations } from './workspace-invitations.ts'
import { workspaceInvitationsContractCases } from './workspace-invitations.contract.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live workspace invitations',
  (it) => {
    // The Seed half of this same list runs in index.test.ts.
    describe('live workspace invitations contract', () => {
      const cases = workspaceInvitationsContractCases(
        {
          emailFor: (slot) => `${slot}@live-invite.test`,
          accepter: { userId: 'usr_accepter', email: 'accepter@live-invite.test' },
          expired: {
            invitationId: 'inv_live_expired',
            email: 'expired@live-invite.test'
          }
        },
        expect
      )
      for (const contractCase of cases) {
        it.effect(contractCase.name, () =>
          Effect.gen(function* () {
            const db = yield* Database
            // The cases clean up after themselves via `removeMember`, so the
            // member binding is needed alongside the invitation one.
            const { binding: invitationBinding } = fakeInvitationBinding(db)
            const { binding: memberBinding } = fakeMemberBinding(db)
            yield* inWorkspace(
              'live-lab',
              contractCase.assert,
              { userId: 'usr_owner' },
              {
                invitationBinding,
                memberBinding
              }
            )
          })
        )
      }
    })

    describe('live workspace invitation mutations', () => {
      it.effect('creates through the binding, reads it back, and audits it', () =>
        Effect.gen(function* () {
          const db = yield* Database
          const { binding, calls } = fakeInvitationBinding(db)
          const created = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const invitations = yield* WorkspaceInvitations
              return yield* invitations.create({
                email: 'audited@live-invite.test',
                role: 'admin'
              })
            }),
            { userId: 'usr_owner' },
            { invitationBinding: binding }
          )

          // Called with the workspace resolved from context, never a slug.
          expect(calls).toEqual([
            {
              workspaceId: 'wrk_live',
              email: 'audited@live-invite.test',
              role: 'admin'
            }
          ])
          expect(created.role).toBe('admin')
          expect(created.status).toBe('pending')

          const events = yield* inWorkspace(
            'live-lab',
            Effect.flatMap(AuditEventLog, (audit) =>
              Effect.map(audit.list(), (page) => page.events)
            ),
            { userId: 'usr_owner' }
          )
          expect(events.map((event) => event.eventType)).toContain(
            'workspace_invitation.sent'
          )
        })
      )

      it.effect('fails as unavailable when no binding is configured', () =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            inWorkspace(
              'live-lab',
              Effect.gen(function* () {
                const invitations = yield* WorkspaceInvitations
                return yield* invitations.create({
                  email: 'unbound@live-invite.test',
                  role: 'member'
                })
              }),
              { userId: 'usr_owner' }
            )
          )
          expect(error).toBeInstanceOf(CapabilityUnavailable)
          expect(error instanceof CapabilityUnavailable && error.reason).toBe(
            'no_invitation_binding'
          )
        })
      )
    })
  }
)
