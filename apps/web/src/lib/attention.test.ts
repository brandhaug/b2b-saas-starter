import { describe, expect, it } from 'vite-plus/test'
import { attentionItems } from './attention'
import { demoFixtures } from './demo-fixtures'

describe('dashboard audit provenance', () => {
  it('distinguishes an API token from a system job without a joined user', () => {
    const event = {
      eventType: 'api_token.created',
      targetType: 'api_token',
      targetId: null,
      actor: 'system',
      createdAt: '2026-09-06T12:00:00.000Z'
    }
    const items = attentionItems({
      invitations: null,
      apiTokens: null,
      webhooks: null,
      auditEvents: [
        { ...event, id: 'token', actorType: 'api_token' },
        { ...event, id: 'job', actorType: 'system' }
      ]
    })
    expect(items[0]?.description).toContain('API token')
    expect(items[1]?.description).toContain('System')
    expect(items[0]?.title).toBe(items[1]?.title)
  })
})

describe('workspace attention decisions', () => {
  it('keeps pending invitations informational and highlights only unhealthy endpoints', () => {
    const items = attentionItems({
      invitations: demoFixtures.dashboard.invitations,
      apiTokens: null,
      webhooks: demoFixtures.dashboard.webhooks,
      auditEvents: null
    })
    expect(items.find((item) => item.id === 'pending-invitations')?.severity).toBe(
      'info'
    )
    const endpoints = items.filter((item) => item.id.startsWith('endpoint-'))
    expect(endpoints).toHaveLength(0)
  })
})

it('links an unhealthy endpoint directly to its deliveries', () => {
  const [endpoint] = demoFixtures.dashboard.webhooks
  if (endpoint === undefined) {
    throw new Error('Missing fixture endpoint')
  }
  const items = attentionItems({
    invitations: null,
    apiTokens: null,
    auditEvents: null,
    webhooks: [{ ...endpoint, enabled: true, successRate: 80 }]
  })
  expect(items[0]?.title).toContain('80%')
  expect(items[0]?.search).toEqual({ tab: 'endpoints', record: endpoint.id })
})
