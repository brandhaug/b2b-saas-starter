import { Effect, Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { AuditEventLog, SeedAuditEventLog } from '../governance/audit-event-log.ts'
import { seedNotificationPreferences } from '../seed-fixture.ts'
import {
  NOTIFICATION_KINDS,
  defaultChannelFor,
  isSecurityNotificationKind,
  resolveChannel
} from './notification-kinds.ts'
import {
  NotificationPreferences,
  SeedNotificationPreferences,
  resolvePreferences
} from './notification-preferences.ts'

describe('notification preference resolution', () => {
  it('defaults the security kinds to instant and everything else to digest', () => {
    for (const kind of NOTIFICATION_KINDS) {
      if (isSecurityNotificationKind(kind)) {
        expect(defaultChannelFor(kind)).toBe('instant')
      } else {
        expect(defaultChannelFor(kind)).toBe('digest')
      }
    }
    expect(defaultChannelFor('api_token.created')).toBe('instant')
    expect(defaultChannelFor('two_factor.changed')).toBe('instant')
    expect(defaultChannelFor('webhook.delivery_failed')).toBe('digest')
    expect(defaultChannelFor('announcement')).toBe('digest')
  })

  it('lets a stored choice override the default, including choosing the default itself', () => {
    expect(resolveChannel('api_token.created', undefined)).toBe('instant')
    expect(resolveChannel('api_token.created', 'off')).toBe('off')
    expect(resolveChannel('announcement', 'instant')).toBe('instant')
    expect(resolveChannel('announcement', 'digest')).toBe('digest')
  })

  it('resolves one entry per kind and marks explicit rows as non-default', () => {
    const resolved = resolvePreferences(new Map([['announcement', 'off']]))
    expect(resolved).toHaveLength(NOTIFICATION_KINDS.length)
    expect(resolved.find((entry) => entry.kind === 'announcement')).toEqual({
      kind: 'announcement',
      channel: 'off',
      isDefault: false
    })
    expect(resolved.find((entry) => entry.kind === 'api_token.revoked')).toEqual({
      kind: 'api_token.revoked',
      channel: 'instant',
      isDefault: true
    })
  })
})

describe('seed notification preferences', () => {
  const audit = SeedAuditEventLog([])
  const layer = Layer.merge(
    audit,
    SeedNotificationPreferences(seedNotificationPreferences).pipe(Layer.provide(audit))
  )

  it.effect('reads the demo owner’s mix and defaults for everyone else', () =>
    Effect.gen(function* () {
      const preferences = yield* NotificationPreferences
      expect(yield* preferences.resolve('usr_demo', 'api_token.created')).toBe('digest')
      expect(yield* preferences.resolve('usr_demo', 'webhook.delivery_failed')).toBe(
        'instant'
      )
      expect(yield* preferences.resolve('usr_demo', 'announcement')).toBe('off')
      expect(yield* preferences.resolve('usr_demo', 'api_token.revoked')).toBe(
        'instant'
      )
      expect(yield* preferences.resolve('usr_dev', 'api_token.created')).toBe('instant')
      expect(yield* preferences.resolve('usr_dev', 'announcement')).toBe('digest')
    }).pipe(Effect.provide(layer))
  )

  it.effect('stores a choice, reads it back, and audits it against the user', () =>
    Effect.gen(function* () {
      const preferences = yield* NotificationPreferences
      const set = yield* preferences.set({
        userId: 'usr_dev',
        kind: 'webhook.delivery_failed',
        channel: 'off'
      })
      expect(set).toEqual({
        kind: 'webhook.delivery_failed',
        channel: 'off',
        isDefault: false
      })
      expect(yield* preferences.resolve('usr_dev', 'webhook.delivery_failed')).toBe(
        'off'
      )
      const listed = yield* preferences.list('usr_dev')
      expect(
        listed.filter((entry) => !entry.isDefault).map((entry) => entry.kind)
      ).toEqual(['webhook.delivery_failed'])
      const log = yield* AuditEventLog
      const events = yield* log.listGlobal
      expect(
        events.some((event) => event.eventType === 'notification_preference.changed')
      ).toBe(true)
    }).pipe(Effect.provide(layer))
  )
})
