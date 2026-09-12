import { type Member } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { fireEvent, screen, waitFor } from '@testing-library/react'
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
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Dev Member' }))
    expect(screen.getByRole('menuitem', { name: 'Make admin' })).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Make owner' })).not.toBeNull()
    expect(screen.queryByText('Your role cannot change member roles.')).toBeNull()
  })

  it('withholds the owner role from an admin — the plugin reserves it for owners', async () => {
    await renderPanel('admin', 'usr_ops')
    // `member:update` covers the admin's changes of a plain member…
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Dev Member' }))
    expect(screen.getByRole('menuitem', { name: 'Make admin' })).not.toBeNull()
    // …but "Make owner" would only ever fail: only owners grant the owner
    // role, so the button is not offered at all.
    expect(screen.queryByRole('menuitem', { name: 'Make owner' })).toBeNull()
    // An owner's own row is beyond an admin entirely — every role change
    // there is refused — so it carries no buttons either.
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Demo Owner' }))
    expect(screen.queryByRole('menuitem', { name: 'Make member' })).toBeNull()
    expect(screen.getAllByRole('menuitem', { name: 'Remove' }).length).toBeGreaterThan(
      0
    )
  })

  it('replaces the role controls with a reason for a viewer who cannot', async () => {
    await renderPanel('member', 'usr_dev')
    expect(screen.getByText('Your role cannot change member roles.')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Dev Member' }))
    expect(screen.queryByRole('menuitem', { name: 'Make admin' })).toBeNull()
    // `member:delete` is denied with `member:update` — no removal either.
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).toBeNull()
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
    expect(screen.getByText('No members yet')).not.toBeNull()
  })

  it('offers removal for other rows but never the actor’s own', async () => {
    await renderPanel('owner')
    expect(
      screen.getByRole('button', { name: 'More actions for Dev Member' })
    ).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'More actions for Ops Admin' })
    ).not.toBeNull()
    // The own row carries the leave verb instead — removing yourself is
    // leaving, and leaving has no `member:delete` requirement.
    expect(
      screen.getByRole('button', { name: 'More actions for Demo Owner' })
    ).not.toBeNull()
    expect(screen.queryByLabelText('Leave workspace')).toBeNull()
  })

  it('offers the leave verb on the actor’s own row to a plain member too', async () => {
    await renderPanel('member', 'usr_dev')
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Dev Member' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave workspace' }))
    expect(screen.getByLabelText('Confirm leave')).not.toBeNull()
    expect(
      screen.queryByRole('button', { name: 'More actions for Dev Member' })
    ).toBeNull()
  })

  it('opens an explicit removal confirmation from the row menu', async () => {
    await renderPanel('owner')
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Dev Member' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(screen.getByRole('alertdialog')).not.toBeNull()
    expect(screen.getByText('Remove Dev Member?')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('filters a large roster by name and email', async () => {
    const manyMembers: ReadonlyArray<Member> = Array.from(
      { length: 50 },
      (_, index) => ({
        id: `usr_${index}`,
        name: index === 42 ? 'Ada Lovelace' : `Member ${index}`,
        email: index === 42 ? 'ada@example.com' : `member-${index}@example.com`,
        role: 'member',
        systemRole: 'user'
      })
    )
    await renderWithRouter(
      <MembersPanel
        workspaceSlug="starter-lab"
        members={manyMembers}
        viewer={{ role: 'owner' }}
        actorUserId="usr_0"
      />
    )
    expect(screen.getAllByText(/@example.com/)).toHaveLength(20)
    expect(screen.getByText('Page 1 of 3')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).not.toBeNull())
    fireEvent.change(screen.getByLabelText('Search members by name or email'), {
      target: { value: 'ada@' }
    })
    expect(screen.getByText('Ada Lovelace')).not.toBeNull()
    expect(screen.queryByText('Member 41')).toBeNull()
  })

  it('restores query and page from the URL and clamps an oversized page', async () => {
    const manyMembers = Array.from({ length: 50 }, (_, index): Member => ({
      id: `usr_${index}`,
      name: `Member ${index}`,
      email: `member-${index}@example.com`,
      role: 'member',
      systemRole: 'user'
    }))
    const { router } = await renderWithRouter(
      <MembersPanel
        workspaceSlug="starter-lab"
        members={manyMembers}
        viewer={{ role: 'owner' }}
        actorUserId="usr_0"
      />,
      { initialEntry: '/?query=member&page=9' }
    )
    expect(screen.getByDisplayValue('member')).not.toBeNull()
    await waitFor(() => expect(router.state.location.search.page).toBe('3'))
    expect(screen.getAllByText(/@example.com/)).toHaveLength(10)
    expect(screen.getByText('Member 49')).not.toBeNull()
  })
})
