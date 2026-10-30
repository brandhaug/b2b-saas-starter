// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vite-plus/test'
import { auditSearchFromFilters, compact } from '@/lib/audit-search'
import * as Api from '@/lib/server/workspace-audit'
import { renderWorkspace } from './test-harness'

const event = {
  id: 'aud_delivery',
  eventType: 'webhook.delivery_failed',
  actor: '<script>private</script>',
  actorType: 'system' as const,
  actorUserId: null,
  targetType: 'webhook_endpoint',
  targetId: 'wh_operations',
  createdAt: '2026-06-02T10:00:00.000Z',
  metadata: { attempts: 3, responseStatus: 503 }
}
const payload: Api.WorkspaceAuditPayload = {
  selectedEvent: null,
  viewer: { role: 'owner' },
  events: [
    {
      id: 'evt_1',
      actorType: 'api_token',
      eventType: 'api_token.created',
      targetType: 'api_token',
      targetId: 'tok_1',
      actor: 'Demo Owner',
      createdAt: '2026-08-01T00:00:00.000Z'
    }
  ],
  nextCursor: null,
  filters: {},
  members: [{ id: 'usr_demo', name: 'Demo Owner' }]
}
function search() {
  return Object.fromEntries(new URL(window.location.href).searchParams)
}
async function renderPage(
  overrides: Partial<Api.WorkspaceAuditPayload> = {},
  extra = {}
) {
  const data = { ...payload, ...overrides }
  vi.spyOn(Api, 'loadWorkspaceAuditEventsServerFn').mockResolvedValue(data)
  const params = new URLSearchParams({
    ...auditSearchFromFilters(data.filters),
    ...extra
  })
  if (data.view) {
    params.set('view', JSON.stringify(data.view))
  }
  return renderWorkspace(
    { _tag: 'audit', data },
    { url: `/workspaces/starter-lab/audit?${params}` }
  )
}
describe('audit preserved behaviors', () => {
  it('shows credential provenance beside the actor name', async () => {
    await renderPage()
    expect(screen.getByRole('cell', { name: 'Demo Owner API token' })).not.toBeNull()
  })

  it('keeps the actor filter when turning to the next page', async () => {
    await renderPage({ filters: { actorUserId: 'usr_demo' }, nextCursor: 'cur_2' })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() =>
      expect(search()).toEqual({ actor: 'usr_demo', cursor: 'cur_2' })
    )
  })

  it('clears all filters and the cursor', async () => {
    await renderPage({ filters: { actorUserId: 'usr_demo' } }, { cursor: 'cur_2' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(search()).toEqual({}))
  })

  it('clears the serialized advanced view instead of merging it back', async () => {
    await renderPage(
      {
        view: {
          match: 'all',
          filters: [{ field: 'eventType', operator: 'contains', value: 'token' }],
          sorts: []
        }
      },
      { cursor: 'cur_2' }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(search()).toEqual({}))
  })

  it('shows each legacy constraint and removes one without dropping an advanced OR view', async () => {
    const view: NonNullable<Api.WorkspaceAuditPayload['view']> = {
      match: 'any',
      filters: [
        { field: 'eventType', operator: 'contains', value: 'token' },
        { field: 'actorType', operator: 'is', value: 'user' }
      ],
      sorts: [{ field: 'createdAt', direction: 'desc' }]
    }
    await renderPage({
      view,
      filters: {
        actorUserId: 'usr_demo',
        eventType: 'api_token.created',
        since: '2026-08-01',
        until: '2026-08-31'
      }
    })
    expect(screen.getByRole('button', { name: /Remove Event/ })).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Remove When ≥ 2026-08-01' })
    ).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Remove When ≤ 2026-08-31' })
    ).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Actor Demo Owner' }))
    await waitFor(() =>
      expect(search()).toEqual({
        eventType: 'api_token.created',
        since: '2026-08-01',
        until: '2026-08-31',
        view: JSON.stringify(view)
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => expect(search()).toEqual({}))
  })

  it('drops empty values so cleared controls disappear from the URL', () => {
    expect(compact({ actor: '', eventType: 'api_token.created' })).toEqual({
      eventType: 'api_token.created'
    })
  })

  it('translates the payload filter vocabulary into the URL vocabulary', () => {
    expect(
      auditSearchFromFilters({ actorUserId: 'usr_demo', since: '2026-08-01' })
    ).toEqual({ actor: 'usr_demo', since: '2026-08-01' })
  })

  it('renders permitted metadata as text with full actor and target context', async () => {
    await renderPage({ selectedEvent: event }, { event: event.id })
    await screen.findByRole('dialog')
    expect(screen.getByText('<script>private</script>')).not.toBeNull()
    expect(screen.getByText('wh_operations')).not.toBeNull()
    expect(screen.getByText('2026-06-02T10:00:00.000Z')).not.toBeNull()
    expect(screen.getByText(/"attempts": 3/)).not.toBeNull()
    expect(screen.getByText(/"responseStatus": 503/)).not.toBeNull()
    expect(document.querySelector('script')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('restores focus to a replacement event link after the list rerenders', async () => {
    await renderPage({}, { event: 'evt_1' })
    await screen.findByRole('dialog')
    const original = document.getElementById('audit-event-evt_1')
    const replacement = document.createElement('a')
    replacement.id = 'audit-event-evt_1'
    replacement.href = '/workspaces/starter-lab/audit?event=evt_1'
    replacement.textContent = 'Replacement event link'
    original?.replaceWith(replacement)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(document.activeElement).toBe(replacement))
  })
})
