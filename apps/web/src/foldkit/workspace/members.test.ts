// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { describe, expect, it } from 'vite-plus/test'
import { demoFixtures } from '@/lib/demo-fixtures'
import { input } from '@/components/native-test-harness'
import { renderWorkspace } from './test-harness'

const members = [
  {
    id: 'usr_demo',
    name: 'Demo Owner',
    email: 'demo@starter.local',
    role: 'owner' as const,
    systemRole: 'user' as const,
    banned: false
  },
  {
    id: 'usr_ops',
    name: 'Ops Admin',
    email: 'ops@starter.local',
    role: 'admin' as const,
    systemRole: 'user' as const,
    banned: false
  },
  {
    id: 'usr_dev',
    name: 'Dev Member',
    email: 'dev@starter.local',
    role: 'member' as const,
    systemRole: 'user' as const,
    banned: false
  }
] as const
function renderPanel(role: 'owner' | 'admin' | 'member', actorUserId = 'usr_demo') {
  return renderWorkspace(
    { _tag: 'members', data: { ...demoFixtures.members, members, viewer: { role } } },
    { actorUserId }
  )
}
async function open(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }))
  return screen.findByRole('menu')
}
describe('member roster preserved behaviors', () => {
  it('offers every other role to an owner, including the owner role', async () => {
    await renderPanel('owner')
    await open('Dev Member')
    expect(screen.getByRole('menuitem', { name: 'Make admin' })).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Make owner' })).not.toBeNull()
  })

  it('withholds the owner role from an admin', async () => {
    await renderPanel('admin', 'usr_ops')
    await open('Dev Member')
    expect(screen.getByRole('menuitem', { name: 'Make admin' })).not.toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Make owner' })).toBeNull()
    await open('Demo Owner')
    expect(screen.queryByRole('menuitem', { name: 'Make member' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Remove' })).not.toBeNull()
  })

  it('replaces the role controls with a reason for a viewer who cannot', async () => {
    await renderPanel('member', 'usr_dev')
    expect(screen.getByText('Your role cannot change member roles.')).not.toBeNull()
    await open('Dev Member')
    expect(screen.queryByRole('menuitem', { name: 'Make admin' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).toBeNull()
  })

  it('offers removal for other rows but never the actor’s own', async () => {
    await renderPanel('owner')
    await open('Dev Member')
    expect(screen.getByRole('menuitem', { name: 'Remove' })).not.toBeNull()
    await open('Demo Owner')
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Leave workspace' })).not.toBeNull()
  })

  it('offers the leave verb on the actor’s own row to a plain member too', async () => {
    await renderPanel('member', 'usr_dev')
    await open('Dev Member')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave workspace' }))
    expect(await screen.findByRole('alertdialog')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Confirm leave' })).not.toBeNull()
  })

  it('opens an explicit removal confirmation from the row menu', async () => {
    await renderPanel('owner')
    await open('Dev Member')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(await screen.findByRole('alertdialog')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Remove Dev Member?' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('filters a large roster by name and email', async () => {
    const many = Array.from({ length: 50 }, (_, index) => ({
      ...members[2],
      id: `usr_${index}`,
      name: index === 42 ? 'Ada Lovelace' : `Member ${index}`,
      email: index === 42 ? 'ada@example.com' : `member-${index}@example.com`
    }))
    await renderWorkspace({
      _tag: 'members',
      data: { ...demoFixtures.members, members: many }
    })
    expect(screen.getAllByText(/@example.com/)).toHaveLength(20)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).not.toBeNull())
    await input(screen.getByLabelText('Search members by name or email'), 'ada@')
    expect(await screen.findByText('Ada Lovelace')).not.toBeNull()
    expect(screen.queryByText('Member 41')).toBeNull()
  })

  it('restores query and page from the URL and clamps an oversized page', async () => {
    const many = Array.from({ length: 50 }, (_, index) => ({
      ...members[2],
      id: `usr_${index}`,
      name: `Member ${index}`,
      email: `member-${index}@example.com`
    }))
    await renderWorkspace(
      { _tag: 'members', data: { ...demoFixtures.members, members: many } },
      { url: '/workspaces/starter-lab/members?query=member&page=9' }
    )
    expect(screen.getByDisplayValue('member')).not.toBeNull()
    expect(screen.getAllByText(/@example.com/)).toHaveLength(10)
    expect(screen.getByText('Member 49')).not.toBeNull()
    expect(screen.getByText('Page 3 of 3')).not.toBeNull()
  })
})
