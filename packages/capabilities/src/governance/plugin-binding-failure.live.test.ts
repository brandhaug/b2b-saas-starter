import { Effect } from 'effect'
import { describe, expect, layer } from '@effect/vitest'

import { CapabilityUnavailable, MembershipChangeRejected } from '../errors.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  pluginRejection,
  TestDatabase
} from '../testing/live-harness.ts'
import {
  WorkspaceInvitations,
  type WorkspaceInvitationBinding
} from './workspace-invitations.ts'
import {
  WorkspaceMembership,
  type WorkspaceMemberBinding
} from './workspace-membership.ts'

// Decision 23: a rejected binding call is classified by its HTTP status.
// No other live suite reaches this code — every rejection they produce is
// raised by the capability itself, before the binding is ever called — so the
// classifier that separates "the workspace refuses" (409, do not retry) from
// "the store is unreachable" (503, retry) is exercised only here.
layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live binding failure classification',
  (it) => {
    describe('live binding failure classification', () => {
      /** A member binding whose every endpoint rejects with the same cause. */
      function rejectingMemberBinding(cause: unknown): WorkspaceMemberBinding {
        function reject() {
          return Promise.reject(cause)
        }
        return { addMember: reject, removeMember: reject, changeRole: reject }
      }

      it.effect('reads a 4xx rejection as a refusal the caller must not retry', () =>
        Effect.gen(function* () {
          const error = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const membership = yield* WorkspaceMembership
              return yield* Effect.flip(
                membership.addMember({ userId: 'usr_joiner', role: 'member' })
              )
            }),
            { userId: 'usr_owner' },
            {
              memberBinding: rejectingMemberBinding(
                pluginRejection(403, 'user is already a member')
              )
            }
          )

          expect(error).toBeInstanceOf(MembershipChangeRejected)
          expect(error.reason).toBe('user is already a member')
        })
      )

      it.effect('reads a 5xx rejection as the store failing, not a refusal', () =>
        Effect.gen(function* () {
          const error = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const membership = yield* WorkspaceMembership
              return yield* Effect.flip(
                membership.addMember({ userId: 'usr_joiner', role: 'member' })
              )
            }),
            { userId: 'usr_owner' },
            {
              memberBinding: rejectingMemberBinding(
                pluginRejection(502, 'upstream unavailable')
              )
            }
          )

          // 503, so the caller retries. A 409 here would tell them to give up on
          // a change that would have succeeded a moment later.
          expect(error).toBeInstanceOf(CapabilityUnavailable)
          expect(error instanceof CapabilityUnavailable && error.capability).toBe(
            'workspace-membership'
          )
          expect(error.reason).toBe('upstream unavailable')
        })
      )

      it.effect('reads a rejection carrying no status as the store failing', () =>
        Effect.gen(function* () {
          const error = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const membership = yield* WorkspaceMembership
              return yield* Effect.flip(
                membership.addMember({ userId: 'usr_joiner', role: 'member' })
              )
            }),
            { userId: 'usr_owner' },
            {
              memberBinding: rejectingMemberBinding(new TypeError('fetch failed'))
            }
          )

          // A dropped connection or a thrown TypeError from the adapter itself.
          // Nothing said the workspace refused, so the classifier must not decide
          // it did.
          expect(error).toBeInstanceOf(CapabilityUnavailable)
          expect(error.reason).toBe('fetch failed')
        })
      )

      /** The invitation port's counterpart, rejecting the same way. */
      function rejectingInvitationBinding(cause: unknown): WorkspaceInvitationBinding {
        function reject() {
          return Promise.reject(cause)
        }
        return { create: reject, cancel: reject, accept: reject }
      }

      // `workspace-invitations.ts` carries its own copy of `classifyBindingFailure`
      // — same rule, different capability name — so the invitation port needs its
      // own cases rather than inheriting the ones above.
      it.effect('applies the same rule to a refused invitation', () =>
        Effect.gen(function* () {
          const error = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const invitations = yield* WorkspaceInvitations
              return yield* Effect.flip(
                invitations.create({
                  email: 'refused@live-invite.test',
                  role: 'member'
                })
              )
            }),
            { userId: 'usr_owner' },
            {
              invitationBinding: rejectingInvitationBinding(
                pluginRejection(400, 'already invited')
              )
            }
          )

          expect(error).toBeInstanceOf(MembershipChangeRejected)
          expect(error.reason).toBe('already invited')
        })
      )

      it.effect('names its own capability when the invitation store fails', () =>
        Effect.gen(function* () {
          const error = yield* inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const invitations = yield* WorkspaceInvitations
              return yield* Effect.flip(
                invitations.create({
                  email: 'unreachable@live-invite.test',
                  role: 'member'
                })
              )
            }),
            { userId: 'usr_owner' },
            {
              invitationBinding: rejectingInvitationBinding(
                pluginRejection(500, 'invitation store down')
              )
            }
          )

          expect(error).toBeInstanceOf(CapabilityUnavailable)
          expect(error instanceof CapabilityUnavailable && error.capability).toBe(
            'workspace-invitations'
          )
        })
      )
    })
  }
)
