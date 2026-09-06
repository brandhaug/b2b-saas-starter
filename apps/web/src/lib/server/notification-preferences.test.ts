import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  loadNotificationPreferencesHandler,
  toPreferenceRow
} from './notification-preferences.effects'
import { isNotificationKind } from './notification-preferences'
import { fixtureSession } from '@/test/fixture-session'
import type * as AuthModule from './auth'

/**
 * The loader through its handler: the session gate is answered by the mock
 * with the fixture identity under test, and the Seed layer answers (the
 * inert `cloudflare:workers` shim under Vitest leaves `DB` undefined) — the
 * same fixture the landing demo and the D1 seed script read.
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))

vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireRequestSession: async () => fixtureSession(actor)
}))

describe('loadNotificationPreferencesHandler', () => {
  beforeEach(() => {
    actor.userId = 'usr_demo'
  })

  it('returns one labelled row per kind with the demo owner’s mix applied', async () => {
    const { preferences } = await loadNotificationPreferencesHandler()
    const byKind = new Map(preferences.map((row) => [row.kind, row]))
    expect(byKind.size).toBe(9)
    expect(byKind.get('api_token.created')).toMatchObject({
      channel: 'digest',
      isDefault: false,
      security: true,
      label: 'API token created'
    })
    expect(byKind.get('webhook.delivery_failed')).toMatchObject({
      channel: 'instant',
      isDefault: false,
      security: false
    })
    expect(byKind.get('announcement')).toMatchObject({
      channel: 'off',
      isDefault: false
    })
    expect(byKind.get('two_factor.changed')).toMatchObject({
      channel: 'instant',
      isDefault: true,
      security: true
    })
  })

  it('gives a user with no stored rows the defaults only', async () => {
    actor.userId = 'usr_dev'
    const { preferences } = await loadNotificationPreferencesHandler()
    expect(preferences.every((row) => row.isDefault)).toBe(true)
    expect(
      preferences.filter((row) => row.channel === 'instant').map((row) => row.kind)
    ).toEqual([
      'api_token.created',
      'api_token.revoked',
      'workspace_member.role_changed',
      'two_factor.changed',
      'account.impersonated'
    ])
  })
})

describe('preference row copy', () => {
  it('attaches the shared label and description', () => {
    expect(
      toPreferenceRow({
        kind: 'billing.plan_changed',
        channel: 'digest',
        isDefault: true
      })
    ).toEqual({
      kind: 'billing.plan_changed',
      channel: 'digest',
      isDefault: true,
      security: false,
      label: 'Plan changed',
      description:
        'A workspace you belong to is on a different plan. Limits and entitlements follow the new plan from now on.'
    })
  })

  it('accepts only real kinds from the unsubscribe link', () => {
    expect(isNotificationKind('announcement')).toBe(true)
    expect(isNotificationKind('constructor')).toBe(false)
    expect(isNotificationKind('nope')).toBe(false)
    expect(isNotificationKind(undefined)).toBe(false)
  })
})
