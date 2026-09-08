import { expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SeedEmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery.seed'
import { testWorkspaceContext } from '../workspace-context.ts'
import {
  latestInvitationEmailHistory,
  listInvitationEmailHistory
} from './invitation-email-history.ts'
import { EmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery'

const seedWorkspaceRecord = {
  id: 'wrk_live',
  slug: 'live-lab',
  name: 'Live Lab',
  planId: 'free'
}

const deliveryLayer = SeedEmailDelivery()
const ownLayer = Layer.merge(deliveryLayer, testWorkspaceContext(seedWorkspaceRecord))
const otherLayer = Layer.merge(
  deliveryLayer,
  testWorkspaceContext({
    ...seedWorkspaceRecord,
    id: 'wrk_other',
    slug: 'other-lab'
  })
)

it.effect('scopes invitation history to the current workspace', () =>
  Effect.gen(function* () {
    const delivery = yield* EmailDelivery
    const claim = yield* delivery.claim({
      id: 'invitation-history',
      purpose: 'invitation',
      recipient: 'invitee@example.test',
      userId: null,
      workspaceId: seedWorkspaceRecord.id,
      referenceId: 'invite-1'
    })
    if (!claim) {
      expect.fail('expected invitation claim')
    }
    yield* delivery.recordOutcome('invitation-history', claim.token, {
      status: 'logged'
    })
    expect((yield* listInvitationEmailHistory()).map((row) => row.id)).toEqual([
      'invitation-history'
    ])
    expect((yield* latestInvitationEmailHistory('invite-1'))?.id).toBe(
      'invitation-history'
    )
  }).pipe(Effect.provide(ownLayer))
)

it.effect('does not expose another workspace history', () =>
  Effect.gen(function* () {
    expect(yield* listInvitationEmailHistory()).toEqual([])
    expect(yield* latestInvitationEmailHistory('invite-1')).toBeNull()
  }).pipe(Effect.provide(otherLayer))
)
