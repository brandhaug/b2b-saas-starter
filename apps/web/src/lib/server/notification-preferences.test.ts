import { describe, expect, it } from 'vite-plus/test'
import {
  isNotificationKind,
  loadNotificationPreferences,
  toPreferenceRow
} from './notification-preferences'

// The test shim leaves `DB` undefined, so the loader answers from the Seed
// layer — the same fixture the landing demo and the D1 seed script read.
describe('loadNotificationPreferences', () => {
  it('returns one labelled row per kind with the demo owner’s mix applied', async () => {
    const { preferences } = await loadNotificationPreferences({ userId: 'usr_demo' })
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
    const { preferences } = await loadNotificationPreferences({ userId: 'usr_dev' })
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
      description: 'A workspace moved to a different plan.'
    })
  })

  it('accepts only real kinds from the unsubscribe link', () => {
    expect(isNotificationKind('announcement')).toBe(true)
    expect(isNotificationKind('constructor')).toBe(false)
    expect(isNotificationKind('nope')).toBe(false)
    expect(isNotificationKind(undefined)).toBe(false)
  })
})
