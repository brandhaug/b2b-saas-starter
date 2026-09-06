import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { fixtureSession } from '@/test/fixture-session'
import { loadWorkspaceAuditEventsHandler } from './workspace-audit.effects'
import { type WorkspaceAuditFilters } from './workspace-audit'
import type * as AuthModule from './auth'

/**
 * The loader through its handler, against the Seed layer: the session gate
 * is answered by the mock with the fixture identity under test. The seed
 * audit fixture has one workspace-scoped event (`aud_token`,
 * `starter-lab`) and one system-level event with no workspace (`aud_admin`)
 * — which is what makes the scoping assertions below possible.
 */
const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))

vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireRequestSession: async () => fixtureSession(actor)
}))

function load(overrides?: {
  readonly filters?: WorkspaceAuditFilters
  readonly cursor?: string
}) {
  return loadWorkspaceAuditEventsHandler({
    workspaceSlug: 'starter-lab',
    filters: overrides?.filters ?? {},
    ...(overrides?.cursor !== undefined && { cursor: overrides.cursor })
  })
}

describe('loadWorkspaceAuditEventsHandler', () => {
  beforeEach(() => {
    actor.userId = 'usr_demo'
  })

  it('hard-gates the page on auditLog read — a member gets no page at all', async () => {
    // The member denial leaves the boundary as ForbiddenError (403), not as an
    // empty payload: the whole page IS the audit log.
    actor.userId = 'usr_dev'
    await expect(
      loadWorkspaceAuditEventsHandler({
        workspaceSlug: 'starter-lab',
        filters: {}
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('resolves direct event links outside the current list and cursor', async () => {
    const payload = await loadWorkspaceAuditEventsHandler({
      workspaceSlug: 'starter-lab',
      filters: { eventType: 'no.such.event' },
      cursor: 'invalid',
      event: 'aud_token'
    })
    expect(payload.events).toEqual([])
    expect(payload.selectedEvent).toMatchObject({
      id: 'aud_token',
      targetType: 'api_token'
    })
  })

  it.each(['missing', 'aud_admin'])(
    'does not disclose unavailable event %s',
    async (event) => {
      const payload = await loadWorkspaceAuditEventsHandler({
        workspaceSlug: 'starter-lab',
        filters: {},
        event
      })
      expect(payload.selectedEvent).toBeNull()
    }
  )

  it('denies an event lookup to a member', async () => {
    actor.userId = 'usr_dev'
    await expect(
      loadWorkspaceAuditEventsHandler({
        workspaceSlug: 'starter-lab',
        filters: {},
        event: 'aud_token'
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('gives an owner the workspace-scoped events, newest first', async () => {
    const payload = await load()
    expect(payload.viewer).toEqual({ role: 'owner' })
    expect(payload.events.length).toBeGreaterThan(0)
    for (const event of payload.events) {
      // Only this workspace's events — the system-level row stays out.
      expect(event.id).not.toBe('aud_admin')
    }
    const times = payload.events.map((event) => event.createdAt)
    expect(times.toReversed()).toEqual([...times].toSorted())
    // An audit reader also holds the member list, so the actor filter keys on ids.
    expect(payload.members.map((member) => member.id)).toContain('usr_demo')
  })

  it('filters by event type server-side', async () => {
    const payload = await load({
      filters: { eventType: 'api_token.created' }
    })
    expect(payload.filters).toEqual({ eventType: 'api_token.created' })
    expect(payload.events.map((event) => event.eventType)).toEqual([
      'api_token.created'
    ])
  })

  it('returns an empty page for a filter nothing matches', async () => {
    const payload = await load({ filters: { eventType: 'auth.sign_in' } })
    expect(payload.events).toEqual([])
    expect(payload.nextCursor).toBeNull()
  })

  it('walks pages forward with the opaque cursor', async () => {
    const first = await load()
    if (first.nextCursor === null) {
      return
    }
    const second = await load({ cursor: first.nextCursor })
    const firstIds = new Set(first.events.map((event) => event.id))
    for (const event of second.events) {
      // Keyset pagination never repeats a row.
      expect(firstIds.has(event.id)).toBe(false)
    }
  })

  it('echoes the date-range filters back for the controls', async () => {
    const payload = await load({
      filters: { since: '2026-05-01', until: '2026-05-31' }
    })
    expect(payload.filters.since).toBe('2026-05-01')
    expect(payload.filters.until).toBe('2026-05-31')
    // The fixture's token event falls inside May 2026.
    expect(payload.events.map((event) => event.id)).toContain('aud_token')
  })
})
