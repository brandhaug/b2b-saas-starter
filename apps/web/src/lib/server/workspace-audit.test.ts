import { describe, expect, it } from 'vite-plus/test'
import {
  loadWorkspaceAuditEvents,
  type LoadWorkspaceAuditEventsInput,
  type WorkspaceAuditFilters
} from './workspace-audit'

/**
 * The loader seam, driven against the Seed layer: `runWorkspaceCapabilities`
 * resolves `cloudflare:workers` to the inert shim under Vitest (vite.config.ts),
 * so `DB` is undefined and the in-memory fixture answers. The seed audit
 * fixture has one workspace-scoped event (`aud_token`, `starter-lab`) and one
 * system-level event with no workspace (`aud_admin`) — which is what makes the
 * scoping assertions below possible.
 */
const OWNER = 'usr_demo'
const MEMBER = 'usr_dev'

function load(overrides?: {
  readonly filters?: WorkspaceAuditFilters
  readonly cursor?: string
}) {
  const input: LoadWorkspaceAuditEventsInput = {
    workspaceSlug: 'starter-lab',
    userId: OWNER,
    filters: overrides?.filters ?? {}
  }
  if (overrides?.cursor !== undefined) {
    input.cursor = overrides.cursor
  }
  return loadWorkspaceAuditEvents(input)
}

describe('loadWorkspaceAuditEvents', () => {
  it('hard-gates the page on auditLog read — a member gets no page at all', async () => {
    // The member denial leaves the boundary as ForbiddenError (403), not as an
    // empty payload: the whole page IS the audit log.
    await expect(
      loadWorkspaceAuditEvents({
        workspaceSlug: 'starter-lab',
        userId: MEMBER,
        filters: {}
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
    expect(payload.members.map((member) => member.id)).toContain(OWNER)
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
