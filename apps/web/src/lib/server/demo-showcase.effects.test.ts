import { AUDIT_EVENT_TYPES } from '@b2b-saas-starter/capabilities/governance/audit-event-taxonomy'
import { WORKSPACE_ROLES } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { seedMembers } from '@b2b-saas-starter/capabilities/seed-fixture'
import { describe, expect, it } from 'vite-plus/test'

import { loadDemoShowcase } from './demo-showcase.effects'

/**
 * The showcase read against the Seed layer, called directly the way loader
 * tests run without a worker. The behavioral oracle is the actorless scoping:
 * an anonymous read sees broadcast notifications only — the wire shape never
 * carries the targeting column the seed rows filter on — and every member,
 * not just some role, counts. The vocabulary numbers are asserted against
 * the same tuples the effects read, pinning the payload's shape without
 * restating the db enums.
 */
describe('loadDemoShowcase', () => {
  it('reads the seed workspace with broadcast-only notifications', async () => {
    const demo = await loadDemoShowcase()
    expect(demo).not.toBeNull()
    expect(demo!.overview.workspace.slug).toBe('starter-lab')
    expect(demo!.memberCount).toBe(seedMembers.length)
    // The one targeted fixture row (the impersonation notice) is absent: the
    // read runs without an actor, so only broadcast rows reach the payload.
    expect(demo!.overview.notifications.length).toBeGreaterThan(0)
    for (const notification of demo!.overview.notifications) {
      expect(notification).not.toHaveProperty('userId')
    }
    expect(demo!.notificationCount).toBe(demo!.overview.notifications.length)
    expect(demo!.roleCount).toBe(WORKSPACE_ROLES.length)
    expect(demo!.auditEventTypeCount).toBe(AUDIT_EVENT_TYPES.length)
  })
})
