import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { WorkspaceAuditPage } from './workspace-audit-page'
import {
  auditSearchFromFilters,
  compact,
  type ApplyWorkspaceAuditSearch
} from '@/lib/audit-search'
import { type WorkspaceAuditPayload } from '@/lib/server/workspace-audit'
import { renderWithRouter } from '@/test/router-harness'

// The page's one server call, as a port — a real function of the declared
// shape, so the module under test is the one that ships.
const applySearch = vi.fn<ApplyWorkspaceAuditSearch>()

const payload: WorkspaceAuditPayload = {
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

// Rendered under a real router because the shell's nav uses `Link` — same
// harness the assistant page tests use; no route tree, no mocked module.
async function renderPage(overrides: Partial<WorkspaceAuditPayload> = {}) {
  await renderWithRouter(
    <WorkspaceAuditPage
      workspaceSlug="starter-lab"
      data={{ ...payload, ...overrides }}
      applySearch={applySearch}
      selectedEventId={null}
      closeEvent={vi.fn()}
    />,
    { path: '/workspaces/starter-lab/audit' }
  )
}

describe('WorkspaceAuditPage', () => {
  it('shows credential provenance beside the actor name', async () => {
    await renderPage()
    const cell = screen.getByRole('cell', { name: 'Demo Owner API token' })
    expect(cell).not.toBeNull()
  })

  it('keeps the actor filter when turning to the next page', async () => {
    // Regression: the page used to spread the payload's `actorUserId`-keyed
    // filters into an `actor`-keyed search update, so the actor vanished on
    // any page turn or second filter change.
    await renderPage({ filters: { actorUserId: 'usr_demo' }, nextCursor: 'cur_2' })
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(applySearch).toHaveBeenCalledWith({ actor: 'usr_demo', cursor: 'cur_2' })
  })

  it('clears all filters and the cursor', async () => {
    await renderPage({ filters: { actorUserId: 'usr_demo' }, nextCursor: 'cur_2' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(applySearch).toHaveBeenCalledWith({})
  })

  it('clears the serialized advanced view instead of merging it back', async () => {
    await renderPage({
      view: {
        match: 'all',
        filters: [{ field: 'eventType', operator: 'contains', value: 'token' }],
        sorts: []
      },
      nextCursor: 'cur_2'
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(applySearch).toHaveBeenCalledWith({})
  })

  it('shows each legacy constraint and removes one without dropping an advanced OR view', async () => {
    const view = {
      match: 'any',
      filters: [
        { field: 'eventType', operator: 'contains', value: 'token' },
        { field: 'actorType', operator: 'is', value: 'user' }
      ],
      sorts: [{ field: 'createdAt', direction: 'desc' }]
    } satisfies NonNullable<WorkspaceAuditPayload['view']>
    await renderPage({
      view,
      filters: {
        actorUserId: 'usr_demo',
        eventType: 'api_token.created',
        since: '2026-08-01',
        until: '2026-08-31'
      },
      nextCursor: 'cur_2'
    })
    expect(screen.getByRole('button', { name: /Remove Event/ })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Remove When ≥ 2026-08-01' })
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Remove When ≤ 2026-08-31' })
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Actor Demo Owner' }))
    expect(applySearch).toHaveBeenLastCalledWith({
      eventType: 'api_token.created',
      since: '2026-08-01',
      until: '2026-08-31',
      view: JSON.stringify(view)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(applySearch).toHaveBeenLastCalledWith({})
  })

  it('drops empty values so cleared controls disappear from the URL', () => {
    expect(compact({ actor: '', eventType: 'api_token.created' })).toEqual({
      eventType: 'api_token.created'
    })
  })

  it('translates the payload filter vocabulary into the URL vocabulary', () => {
    expect(
      auditSearchFromFilters({ actorUserId: 'usr_demo', since: '2026-08-01' })
    ).toEqual({
      actor: 'usr_demo',
      since: '2026-08-01'
    })
  })
})
