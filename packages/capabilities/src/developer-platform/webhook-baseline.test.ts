import { Effect, Layer } from 'effect'
import { expect, it } from '@effect/vitest'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'

import { MembershipChangeRejected } from '../errors.ts'
import { SeedAuditEventLog } from '../governance/audit-event-log.ts'
import {
  makeSeedRoster,
  SeedWorkspaceMembership,
  WorkspaceMembership
} from '../governance/workspace-membership.ts'
import { SeedWorkspaceInvitations } from '../governance/workspace-invitations.seed.ts'
import { type Member } from '../governance/workspace-identity.ts'
import { SeedSeatSyncPublisher } from '@b2b-saas-starter/billing/seat-sync'
import {
  WebhookPublisher,
  type PublishWebhookEventInput,
  type WebhookPublisherInterface
} from './webhook-publisher.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import { WorkspaceInvitations } from '../governance/workspace-invitations.ts'

const workspace = {
  id: 'wrk_webhook_baseline',
  slug: 'webhook-baseline',
  name: 'Webhook Baseline',
  planId: 'team'
}

const owner: Member = {
  id: 'usr_owner',
  name: 'Owner',
  email: 'owner@webhook.test',
  role: 'owner',
  systemRole: 'user'
}

const member: Member = {
  id: 'usr_member',
  name: 'Member',
  email: 'member@webhook.test',
  role: 'member',
  systemRole: 'user'
}

function fixture(options?: {
  readonly publish?: NonNullable<WebhookPublisherInterface['publishForWorkspace']>
  readonly failPublish?: boolean
}) {
  const published: Array<{
    readonly workspaceId: string
    readonly input: PublishWebhookEventInput
  }> = []
  const publisher = Layer.succeed(WebhookPublisher)({
    publish: (input) => {
      published.push({ workspaceId: workspace.id, input })
      if (options?.failPublish) {
        return Effect.fail(
          new CapabilityUnavailable({
            capability: 'webhook-publisher',
            reason: 'test_queue_down'
          })
        )
      }
      return Effect.void
    },
    publishForWorkspace: (workspaceId, input) => {
      published.push({ workspaceId, input })
      return options?.publish?.(workspaceId, input) ?? Effect.void
    },
    enqueue: () => Effect.void
  })

  const layer = Layer.unwrap(
    Effect.gen(function* () {
      const roster = yield* makeSeedRoster([owner, member])
      const audit = SeedAuditEventLog([])
      return Layer.mergeAll(
        testWorkspaceContext(workspace, {
          userId: owner.id,
          role: owner.role,
          systemRole: owner.systemRole
        }),
        audit,
        publisher,
        SeedSeatSyncPublisher,
        SeedWorkspaceMembership(roster, workspace).pipe(
          Layer.provide(publisher),
          Layer.provide(SeedSeatSyncPublisher)
        ),
        SeedWorkspaceInvitations({ roster, workspace }).pipe(
          Layer.provide(publisher),
          Layer.provide(SeedSeatSyncPublisher)
        )
      )
    })
  )
  return { layer, published }
}

it.effect('publishes scoped membership changes and no events for refusals', () => {
  const { layer, published } = fixture()
  return Effect.gen(function* () {
    const membership = yield* WorkspaceMembership
    yield* membership.changeRole({ userId: member.id, role: 'admin' })
    yield* membership.removeMember({ userId: member.id })

    const beforeRefusal = published.length
    const refused = yield* Effect.flip(
      membership.removeMember({ userId: 'usr_missing' })
    )
    expect(refused).toBeInstanceOf(MembershipChangeRejected)
    expect(published).toHaveLength(beforeRefusal)
    expect(published).toEqual([
      {
        workspaceId: workspace.id,
        input: {
          eventType: 'workspace_member.role_changed',
          payload: { userId: member.id, role: 'admin' }
        }
      },
      {
        workspaceId: workspace.id,
        input: {
          eventType: 'workspace_member.removed',
          payload: { userId: member.id }
        }
      }
    ])
  }).pipe(Effect.provide(layer))
})

it.effect('does not publish a no-op role change', () => {
  const { layer, published } = fixture()
  return Effect.gen(function* () {
    const membership = yield* WorkspaceMembership
    yield* membership.changeRole({ userId: member.id, role: member.role })
    expect(published).toEqual([])
  }).pipe(Effect.provide(layer))
})

it.effect('acceptance publishes both events, scopes them, and rejects repeats', () => {
  const { layer, published } = fixture()
  return Effect.gen(function* () {
    const invitations = yield* WorkspaceInvitations
    const invitation = yield* invitations.create({
      email: 'joiner@webhook.test',
      role: 'member'
    })
    const wrongRecipient = yield* Effect.flip(
      invitations.accept({
        invitationId: invitation.id,
        userId: 'usr_joiner',
        email: 'attacker@webhook.test'
      })
    )
    expect(wrongRecipient).toBeInstanceOf(MembershipChangeRejected)
    expect(published).toEqual([])
    yield* invitations.accept({
      invitationId: invitation.id,
      userId: 'usr_joiner',
      email: 'joiner@webhook.test'
    })
    expect(published).toHaveLength(2)
    expect(published.map(({ workspaceId }) => workspaceId)).toEqual([
      workspace.id,
      workspace.id
    ])
    expect(published.map(({ input }) => input)).toEqual([
      {
        eventType: 'workspace_invitation.accepted',
        payload: {
          invitationId: invitation.id,
          userId: 'usr_joiner',
          role: 'member'
        }
      },
      {
        eventType: 'workspace_member.added',
        payload: { userId: 'usr_joiner', role: 'member' }
      }
    ])

    const repeated = yield* Effect.flip(
      invitations.accept({
        invitationId: invitation.id,
        userId: 'usr_joiner',
        email: 'joiner@webhook.test'
      })
    )
    expect(repeated).toBeInstanceOf(MembershipChangeRejected)
    expect(published).toHaveLength(2)
  }).pipe(Effect.provide(layer))
})

it.effect('keeps successful state changes when webhook delivery fails', () => {
  const { layer, published } = fixture({
    failPublish: true
  })
  return Effect.gen(function* () {
    const membership = yield* WorkspaceMembership
    yield* membership.changeRole({ userId: member.id, role: 'admin' })
    const members = yield* membership.listMembers
    expect(members.find(({ id }) => id === member.id)?.role).toBe('admin')
    expect(published).toHaveLength(1)
  }).pipe(Effect.provide(layer))
})
