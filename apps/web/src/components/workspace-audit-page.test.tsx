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
  viewer: { role: 'owner' },
  events: [
    {
      id: 'evt_1',
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
    />,
    { path: '/workspaces/starter-lab/audit' }
  )
}

describe('WorkspaceAuditPage', () => {
  it('keeps the actor filter when turning to the next page', async () => {
    // Regression: the page used to spread the payload's `actorUserId`-keyed
    // filters into an `actor`-keyed search update, so the actor vanished on
    // any page turn or second filter change.
    await renderPage({ filters: { actorUserId: 'usr_demo' }, nextCursor: 'cur_2' })
    fireEvent.click(screen.getByRole('button', { name: 'Older events' }))
    expect(applySearch).toHaveBeenCalledWith({ actor: 'usr_demo', cursor: 'cur_2' })
  })

  it('drops the cursor but keeps the actor when a filter changes', async () => {
    await renderPage({ filters: { actorUserId: 'usr_demo' }, nextCursor: 'cur_2' })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(applySearch).toHaveBeenCalledWith({ actor: 'usr_demo' })
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
