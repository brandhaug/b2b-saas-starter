import { type Member } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { MembersPanel } from './members-panel'
import { renderWithRouter } from '@/test/router-harness'

const members: ReadonlyArray<Member> = [
  {
    id: 'usr_demo',
    name: 'Demo Owner',
    email: 'demo@starter.local',
    role: 'owner',
    systemRole: 'user'
  },
  {
    id: 'usr_dev',
    name: 'Dev Member',
    email: 'dev@starter.local',
    role: 'member',
    systemRole: 'user'
  }
]

function renderPanel(role: 'owner' | 'member') {
  return renderWithRouter(
    <MembersPanel workspaceSlug="starter-lab" members={members} viewer={{ role }} />
  )
}

describe('MembersPanel', () => {
  it('offers every other role to a viewer who can change roles', async () => {
    await renderPanel('owner')
    expect(screen.getByLabelText('Make admin: Dev Member')).toBeTruthy()
    expect(screen.getByLabelText('Make owner: Dev Member')).toBeTruthy()
    // A member is never offered the role they already hold.
    expect(screen.queryByLabelText('Make member: Dev Member')).toBeNull()
    expect(screen.queryByLabelText('Make owner: Demo Owner')).toBeNull()
    expect(screen.queryByText('Your role cannot change member roles.')).toBeNull()
  })

  it('replaces the controls with a reason for a viewer who cannot', async () => {
    await renderPanel('member')
    expect(screen.getByText('Your role cannot change member roles.')).toBeTruthy()
    expect(screen.queryByLabelText('Make admin: Dev Member')).toBeNull()
  })

  it('shows the empty state with no members', async () => {
    await renderWithRouter(
      <MembersPanel
        workspaceSlug="starter-lab"
        members={[]}
        viewer={{ role: 'owner' }}
      />
    )
    expect(screen.getByText('No members yet')).toBeTruthy()
  })
})
