import {
  NotificationFeed,
  type NotificationEmailContext,
  type SeedNotification
} from './notification-feed.ts'
import { SeedNotificationFeed } from './notification-feed.seed.ts'
import {
  type NotificationPreferences,
  SeedNotificationPreferences
} from './notification-preferences.ts'
import {
  NotificationEmailEligibility,
  layerWithoutDependencies as NotificationEmailEligibilityLayer,
  type InstantNotificationEmailInput
} from './notification-email-eligibility.ts'
import {
  WorkspaceSuspended,
  WorkspaceSuspensionService
} from '../governance/workspace-suspension.ts'
import { SeedAuditEventLog } from '../governance/audit-event-log.ts'
import { SeedAccountPreferences } from '../governance/account-preferences.ts'
import { seedMembers, seedWorkspaceRecord } from '../seed-fixture.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import { SeedEmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery.seed'
import { EmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'

const workspace = { id: 'wrk_1', slug: 'starter-lab', name: 'Starter Lab' }
const recipient = {
  userId: 'usr_owner',
  email: 'owner@example.com',
  name: 'Owner'
}

const context: NotificationEmailContext = {
  notification: {
    id: 'not_1',
    kind: 'announcement',
    title: 'Announcement',
    message: 'A message',
    createdAt: '2026-09-02T10:00:00.000Z',
    read: false
  },
  recipient,
  workspace
}

function stubFeed(
  instant: NotificationEmailContext | null,
  digest: ReadonlyArray<NotificationEmailContext> = []
): Layer.Layer<NotificationFeed> {
  return Layer.succeed(NotificationFeed)({
    list: Effect.die('unused'),
    listPage: () => Effect.die('unused'),
    unreadCount: Effect.die('unused'),
    markRead: () => Effect.die('unused'),
    create: () => Effect.die('unused'),
    record: () => Effect.die('unused'),
    notifyUser: () => Effect.die('unused'),
    notifyWorkspaceOwners: () => Effect.die('unused'),
    prepareWorkspaceOwners: () => Effect.die('unused'),
    loadForEmail: () => Effect.succeed(instant),
    listDigestCandidates: () => Effect.succeed(digest)
  })
}

function suspensionLayer(
  requireAllowed: WorkspaceSuspensionService['Service']['requireAllowed']
): Layer.Layer<WorkspaceSuspensionService> {
  return Layer.succeed(WorkspaceSuspensionService)({
    list: Effect.succeed([]),
    get: () => Effect.die('unused'),
    requireAllowed,
    transition: () => Effect.die('unused')
  })
}

function eligibilityLayer(
  feed: Layer.Layer<NotificationFeed>,
  preferences: Layer.Layer<NotificationPreferences>,
  suspension: Layer.Layer<WorkspaceSuspensionService>
) {
  const delivery = SeedEmailDelivery()
  const dependencies = Layer.mergeAll(feed, preferences, suspension, delivery)
  return Layer.merge(
    dependencies,
    NotificationEmailEligibilityLayer.pipe(Layer.provide(dependencies))
  )
}

function seedEligibilityLayer(
  seed: ReadonlyArray<SeedNotification>,
  preferences: ReadonlyArray<{
    readonly userId: string
    readonly kind: SeedNotification['kind']
    readonly channel: 'off' | 'instant' | 'digest'
  }>
) {
  const audit = SeedAuditEventLog([])
  const accountPreferences = SeedAccountPreferences([
    { userId: 'usr_demo', locale: null, timeZone: null }
  ]).pipe(Layer.provide(audit))
  const notificationPreferences = SeedNotificationPreferences(preferences).pipe(
    Layer.provide(audit)
  )
  const feed = SeedNotificationFeed(seed, {
    workspace: seedWorkspaceRecord,
    members: seedMembers
  }).pipe(Layer.provide(Layer.merge(accountPreferences, notificationPreferences)))
  const suspension = suspensionLayer(() => Effect.void)
  const delivery = SeedEmailDelivery()
  const dependencies = Layer.mergeAll(
    feed,
    notificationPreferences,
    suspension,
    delivery
  )
  return Layer.mergeAll(
    audit,
    accountPreferences,
    notificationPreferences,
    feed,
    suspension,
    delivery,
    NotificationEmailEligibilityLayer.pipe(Layer.provide(dependencies))
  )
}

const instantInput: InstantNotificationEmailInput = {
  notificationId: context.notification.id,
  recipientUserId: recipient.userId
}

describe('NotificationEmailEligibility', () => {
  it.effect('returns an instant context only for the current instant preference', () =>
    Effect.gen(function* () {
      const eligibility = yield* NotificationEmailEligibility
      expect(yield* eligibility.instant(instantInput)).toEqual({
        _tag: 'deliver',
        context
      })
    }).pipe(
      Effect.provide(
        eligibilityLayer(
          stubFeed(context),
          SeedNotificationPreferences([
            { userId: recipient.userId, kind: 'announcement', channel: 'instant' }
          ]).pipe(Layer.provide(SeedAuditEventLog([]))),
          suspensionLayer(() => Effect.void)
        )
      )
    )
  )

  it.effect('skips an instant message when the preference changed before send', () =>
    Effect.gen(function* () {
      const eligibility = yield* NotificationEmailEligibility
      const delivery = yield* EmailDelivery
      yield* delivery.claim({
        id: 'notification:not_1:usr_owner',
        purpose: 'notification',
        recipient: recipient.email,
        userId: recipient.userId,
        workspaceId: null,
        referenceId: context.notification.id
      })
      expect(yield* eligibility.instant(instantInput)).toEqual({
        _tag: 'skip',
        reason: 'channel_digest'
      })
      expect((yield* delivery.get('notification:not_1:usr_owner'))?.reason).toBe(
        'no_longer_relevant'
      )
    }).pipe(
      Effect.provide(
        eligibilityLayer(
          stubFeed(context),
          SeedNotificationPreferences([
            { userId: recipient.userId, kind: 'announcement', channel: 'digest' }
          ]).pipe(Layer.provide(SeedAuditEventLog([]))),
          suspensionLayer(() => Effect.void)
        )
      )
    )
  )

  it.effect('settles suspended instant work with durable suppression evidence', () =>
    Effect.gen(function* () {
      const eligibility = yield* NotificationEmailEligibility
      const result = yield* eligibility.instant(instantInput)
      const delivery = yield* EmailDelivery
      expect(result).toEqual({ _tag: 'skip', reason: 'workspace_suspended' })
      expect((yield* delivery.get('notification:not_1:usr_owner'))?.reason).toBe(
        'workspace_suspended'
      )
    }).pipe(
      Effect.provide(
        eligibilityLayer(
          stubFeed(context),
          SeedNotificationPreferences([]).pipe(Layer.provide(SeedAuditEventLog([]))),
          suspensionLayer(() =>
            Effect.fail(new WorkspaceSuspended({ workspaceId: workspace.id }))
          )
        )
      )
    )
  )

  it.effect('suppresses a digest item after suspension even after reactivation', () => {
    let suspended = true
    const candidates = [context]
    return Effect.gen(function* () {
      const eligibility = yield* NotificationEmailEligibility
      const first = yield* eligibility.digest({
        since: '2026-09-02T08:00:00.000Z',
        until: '2026-09-03T08:00:00.000Z'
      })
      suspended = false
      const second = yield* eligibility.digest({
        since: '2026-09-02T08:00:00.000Z',
        until: '2026-09-03T08:00:00.000Z'
      })
      expect(first).toEqual({
        candidateCount: 0,
        candidates: [],
        suspendedCount: 1
      })
      expect(second).toEqual({
        candidateCount: 0,
        candidates: [],
        suspendedCount: 1
      })
    }).pipe(
      Effect.provide(
        eligibilityLayer(
          stubFeed(context, candidates),
          SeedNotificationPreferences([
            { userId: recipient.userId, kind: 'announcement', channel: 'digest' }
          ]).pipe(Layer.provide(SeedAuditEventLog([]))),
          suspensionLayer(() => {
            if (suspended) {
              return Effect.fail(new WorkspaceSuspended({ workspaceId: workspace.id }))
            }
            return Effect.void
          })
        )
      )
    )
  })

  it.effect('keeps account security notices eligible during workspace suspension', () =>
    Effect.gen(function* () {
      const eligibility = yield* NotificationEmailEligibility
      const result = yield* eligibility.instant(instantInput)
      expect(result).toEqual({
        _tag: 'deliver',
        context: {
          ...context,
          notification: { ...context.notification, kind: 'api_token.created' }
        }
      })
    }).pipe(
      Effect.provide(
        eligibilityLayer(
          stubFeed({
            ...context,
            notification: { ...context.notification, kind: 'api_token.created' }
          }),
          SeedNotificationPreferences([]).pipe(Layer.provide(SeedAuditEventLog([]))),
          suspensionLayer(() =>
            Effect.fail(new WorkspaceSuspended({ workspaceId: workspace.id }))
          )
        )
      )
    )
  )

  it.effect('re-reads the Seed feed after an instant notification becomes read', () =>
    Effect.gen(function* () {
      const eligibility = yield* NotificationEmailEligibility
      const feed = yield* NotificationFeed
      const input = { notificationId: 'seed_read', recipientUserId: 'usr_demo' }

      expect(yield* eligibility.instant(input)).toMatchObject({ _tag: 'deliver' })
      yield* feed.markRead(['seed_read'])
      expect(yield* eligibility.instant(input)).toEqual({
        _tag: 'skip',
        reason: 'not_deliverable'
      })
    }).pipe(
      Effect.provide(
        Layer.merge(
          seedEligibilityLayer(
            [
              {
                id: 'seed_read',
                userId: 'usr_demo',
                kind: 'announcement',
                title: 'Seed read check',
                message: 'Unread initially.',
                createdAt: '2026-09-02T10:00:00.000Z',
                read: false
              }
            ],
            [{ userId: 'usr_demo', kind: 'announcement', channel: 'instant' }]
          ),
          testWorkspaceContext(seedWorkspaceRecord, {
            userId: 'usr_demo',
            role: 'owner',
            systemRole: 'admin'
          })
        )
      )
    )
  )

  it.effect('re-reads the Seed feed after a digest notification becomes read', () =>
    Effect.gen(function* () {
      const eligibility = yield* NotificationEmailEligibility
      const feed = yield* NotificationFeed
      const window = {
        since: '2026-09-02T00:00:00.000Z',
        until: '2026-09-03T00:00:00.000Z'
      }

      expect((yield* eligibility.digest(window)).candidates).toHaveLength(1)
      yield* feed.markRead(['seed_digest_read'])
      expect(yield* eligibility.digest(window)).toMatchObject({
        candidateCount: 0,
        candidates: []
      })
    }).pipe(
      Effect.provide(
        Layer.merge(
          seedEligibilityLayer(
            [
              {
                id: 'seed_digest_read',
                userId: 'usr_demo',
                kind: 'announcement',
                title: 'Seed digest read check',
                message: 'Unread initially.',
                createdAt: '2026-09-02T10:00:00.000Z',
                read: false
              }
            ],
            []
          ),
          testWorkspaceContext(seedWorkspaceRecord, {
            userId: 'usr_demo',
            role: 'owner',
            systemRole: 'admin'
          })
        )
      )
    )
  )
})
