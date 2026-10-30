import { fireEvent, screen, waitFor, within } from '@testing-library/dom'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { renderWorkspace } from '@/foldkit/workspace/test-harness'
import { demoFixtures } from '@/lib/demo-fixtures'
import {
  changeMemberRoleServerFn,
  loadWorkspaceMembersServerFn
} from '@/lib/server/workspace-members'

vi.mock('@/lib/server/workspace-members', () => ({
  changeMemberRoleServerFn: vi.fn(),
  loadWorkspaceMembersServerFn: vi.fn(),
  removeMemberServerFn: vi.fn(),
  leaveWorkspaceServerFn: vi.fn()
}))
const members = [
  {
    id: 'usr_demo',
    name: 'Owner',
    email: 'owner@example.com',
    role: 'owner' as const,
    systemRole: 'user' as const,
    banned: false
  },
  {
    id: 'row-1',
    name: 'First member',
    email: 'first@example.com',
    role: 'member' as const,
    systemRole: 'user' as const,
    banned: false
  },
  {
    id: 'row-2',
    name: 'Second member',
    email: 'second@example.com',
    role: 'member' as const,
    systemRole: 'user' as const,
    banned: false
  }
]
const data = { ...demoFixtures.members, members }
beforeEach(() => {
  vi.mocked(changeMemberRoleServerFn).mockReset()
  vi.mocked(loadWorkspaceMembersServerFn).mockResolvedValue(data)
})
async function change(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `More actions for ${name}` }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Make admin' }))
}

// A failed row keeps its failure during another request; settlement binds the
// replacement failure to that request's row, or clears it on success.
it('keeps the previous failure visible while the next run is in flight', async () => {
  vi.mocked(changeMemberRoleServerFn).mockRejectedValueOnce(
    new Error('private failure')
  )
  await renderWorkspace({ _tag: 'members', data })
  await change('First member')
  const failure = await screen.findByRole('alert')
  const text = failure.textContent
  let settle: (() => void) | undefined
  vi.mocked(changeMemberRoleServerFn).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        settle = () =>
          resolve({
            id: 'row-1',
            name: 'First member',
            email: 'first@example.com',
            role: 'admin',
            systemRole: 'user',
            banned: false
          })
      })
  )
  await change('First member')
  await waitFor(() => expect(changeMemberRoleServerFn).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('alert').textContent).toBe(text)
  settle?.()
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

it('replaces the failure with the settling run’s own key and message', async () => {
  vi.mocked(changeMemberRoleServerFn).mockRejectedValue(new Error('private failure'))
  await renderWorkspace({ _tag: 'members', data })
  await change('Second member')
  await screen.findByRole('alert')
  const row = screen.getByText('Second member').closest('li')
  if (!row) {
    throw new Error('Member row missing')
  }
  expect(within(row).getByRole('alert').textContent).toContain('role')
})

it('clears once a run settles successfully', async () => {
  vi.mocked(changeMemberRoleServerFn)
    .mockRejectedValueOnce(new Error('private failure'))
    .mockResolvedValue({
      id: 'row-1',
      name: 'First member',
      email: 'first@example.com',
      role: 'admin',
      systemRole: 'user',
      banned: false
    })
  await renderWorkspace({ _tag: 'members', data })
  await change('First member')
  await screen.findByRole('alert')
  await change('First member')
  await waitFor(() => expect(changeMemberRoleServerFn).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})
