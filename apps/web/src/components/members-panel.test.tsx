import { type Member } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { fireEvent, screen } from '@testing-library/react'
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
    id: 'usr_ops',
    name: 'Ops Admin',
    email: 'ops@starter.local',
    role: 'admin',
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

function renderPanel(role: 'owner' | 'admin' | 'member', actorUserId = 'usr_demo') {
  return renderWithRouter(
    <MembersPanel
      workspaceSlug="starter-lab"
      members={members}
      viewer={{ role }}
      actorUserId={actorUserId}
    />
  )
}

describe('MembersPanel', () => {
  it('offers every other role to an owner, including the owner role', async () => {
    await renderPanel('owner')
    expect(screen.getByLabelText('Make admin: Dev Member')).toBeTruthy()
    expect(screen.getByLabelText('Make owner: Dev Member')).toBeTruthy()
    // A member is never offered the role they already hold.
    expect(screen.queryByLabelText('Make member: Dev Member')).toBeNull()
    expect(screen.queryByLabelText('Make owner: Demo Owner')).toBeNull()
    expect(screen.queryByText('Your role cannot change member roles.')).toBeNull()
  })

  it('withholds the owner role from an admin — the plugin reserves it for owners', async () => {
    await renderPanel('admin', 'usr_ops')
    // `member:update` covers the admin's changes of a plain member…
    expect(screen.getByLabelText('Make admin: Dev Member')).toBeTruthy()
    // …but "Make owner" would only ever fail: only owners grant the owner
    // role, so the button is not offered at all.
    expect(screen.queryByLabelText('Make owner: Dev Member')).toBeNull()
    // An owner's own row is beyond an admin entirely — every role change
    // there is refused — so it carries no buttons either.
    expect(screen.queryByLabelText('Make admin: Demo Owner')).toBeNull()
    expect(screen.queryByLabelText('Make member: Demo Owner')).toBeNull()
  })

  it('replaces the role controls with a reason for a viewer who cannot', async () => {
    await renderPanel('member', 'usr_dev')
    expect(screen.getByText('Your role cannot change member roles.')).toBeTruthy()
    expect(screen.queryByLabelText('Make admin: Dev Member')).toBeNull()
    // `member:delete` is denied with `member:update` — no removal either.
    expect(screen.queryByLabelText('Remove Dev Member')).toBeNull()
  })

  it('shows the empty state with no members', async () => {
    await renderWithRouter(
      <MembersPanel
        workspaceSlug="starter-lab"
        members={[]}
        viewer={{ role: 'owner' }}
        actorUserId="usr_demo"
      />
    )
    expect(screen.getByText('No members yet')).toBeTruthy()
  })

  it('offers removal for other rows but never the actor’s own', async () => {
    await renderPanel('owner')
    expect(screen.getByLabelText('Remove Dev Member')).toBeTruthy()
    expect(screen.getByLabelText('Remove Ops Admin')).toBeTruthy()
    // The own row carries the leave verb instead — removing yourself is
    // leaving, and leaving has no `member:delete` requirement.
    expect(screen.queryByLabelText('Remove Demo Owner')).toBeNull()
    expect(screen.getByLabelText('Leave workspace')).toBeTruthy()
  })

  it('offers the leave verb on the actor’s own row to a plain member too', async () => {
    await renderPanel('member', 'usr_dev')
    // Exactly one leave control: the actor's own row, whatever their role.
    expect(screen.getAllByLabelText('Leave workspace')).toHaveLength(1)
  })

  it('arms one removal at a time and disarms on cancel', async () => {
    await renderPanel('owner')
    fireEvent.click(screen.getByLabelText('Remove Dev Member'))
    expect(screen.getByLabelText('Confirm remove Dev Member')).toBeTruthy()
    // The second row stays idle: one armed confirm at a time.
    expect(screen.getByLabelText('Remove Ops Admin')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Cancel Dev Member'))
    expect(screen.queryByLabelText('Confirm remove Dev Member')).toBeNull()
    expect(screen.getByLabelText('Remove Dev Member')).toBeTruthy()
  })
})
