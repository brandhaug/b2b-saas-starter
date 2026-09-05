import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { loadWorkspaceMembers } from '@/lib/server/workspace-members.effects'
import { type WorkspaceMembersPayload } from '@/lib/server/workspace-members'
import { type WorkspaceViewer } from '@/lib/permissions'
import { WorkspaceMembersPage } from '@/components/workspace-members-page'

/**
 * The members page renders its loader projection directly, so the seat
 * prompt's two states are plain props: over a flat plan's included seats the
 * upgrade prompt links to billing; at or under it (or on a per-seat plan,
 * which never flags) the page carries no prompt.
 */

const owner: WorkspaceViewer = { role: 'owner' }

function payload(
  seatUsage: WorkspaceMembersPayload['seatUsage']
): WorkspaceMembersPayload {
  return {
    viewer: owner,
    unreadCount: 0,
    members: [
      {
        id: 'usr_owner',
        name: 'Owner One',
        email: 'owner@seed.local',
        role: 'owner',
        systemRole: 'user'
      },
      {
        id: 'usr_two',
        name: 'Member Two',
        email: 'two@seed.local',
        role: 'member',
        systemRole: 'user'
      }
    ],
    // The invitation segment is upstream's own soft read (`invitation:create`);
    // an empty list is the state these seat-prompt cases care about.
    invitations: [],
    seatUsage
  }
}

const overLimit = payload({
  pricing: 'flat',
  included: 3,
  used: 4,
  overLimit: true
})

const withinLimit = payload({
  pricing: 'flat',
  included: 3,
  used: 2,
  overLimit: false
})

const perSeat = payload({
  pricing: 'per_seat',
  included: null,
  used: 9,
  overLimit: false
})

async function renderPage(data: WorkspaceMembersPayload) {
  return renderWithRouter(
    <WorkspaceMembersPage
      workspaceSlug="starter-lab"
      data={data}
      actorUserId="usr_owner"
    />,
    {
      path: '/workspaces/starter-lab/members',
      destinations: ['/workspaces/starter-lab/billing']
    }
  )
}

describe('WorkspaceMembersPage seat prompt', () => {
  it('prompts an upgrade when members pass the plan’s included seats', async () => {
    await renderPage(overLimit)
    const prompt = screen.getByText(/more than the 3 seats its plan includes/)
    expect(prompt).toBeDefined()
    const link = screen.getByRole('link', { name: /upgrade the plan/i })
    expect(link.getAttribute('href')).toBe('/workspaces/starter-lab/billing')
  })

  it('stays quiet while the roster is within the included seats', async () => {
    await renderPage(withinLimit)
    expect(screen.queryByText(/more than the .* seats its plan includes/)).toBeNull()
  })

  it('never prompts on a per-seat plan, whatever the headcount', async () => {
    await renderPage(perSeat)
    expect(screen.queryByText(/more than the .* seats its plan includes/)).toBeNull()
    expect(screen.queryByRole('link', { name: /upgrade the plan/i })).toBeNull()
  })
})

describe('loadWorkspaceMembers seat usage', () => {
  it('computes seat usage off the seed workspace’s per-seat plan', async () => {
    // Seed layer (inert `cloudflare:workers` shim): `starter-lab` sits on the
    // per-seat Team plan with four fixture members — billed per seat, never
    // over a ceiling.
    const data = await loadWorkspaceMembers({
      workspaceSlug: 'starter-lab',
      userId: 'usr_dev'
    })
    expect(data.seatUsage).toEqual({
      pricing: 'per_seat',
      included: null,
      used: 4,
      overLimit: false
    })
  })
})
