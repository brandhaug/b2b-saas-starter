import { type WorkspaceWithMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  AdminUserActions,
  type ChangeUserWorkspaceRole,
  type ListUserWorkspaces
} from './admin-user-actions'
import { type SystemUser } from '@/lib/server/admin'
import { renderWithRouter } from '@/test/router-harness'

const users: ReadonlyArray<SystemUser> = [
  {
    id: 'usr_dev',
    name: 'Dev Member',
    email: 'dev@starter.local',
    role: 'user',
    banned: false
  }
]

const membership: WorkspaceWithMembership = {
  workspace: { id: 'wrk_1', slug: 'starter-lab', name: 'Starter Lab', planId: 'free' },
  member: {
    id: 'usr_dev',
    name: 'Dev Member',
    email: 'dev@starter.local',
    role: 'member',
    systemRole: 'user'
  }
}

const listWorkspaces = vi.fn<ListUserWorkspaces>()
const changeUserRole = vi.fn<ChangeUserWorkspaceRole>()

function renderActions() {
  return renderWithRouter(
    <AdminUserActions
      users={users}
      listWorkspaces={listWorkspaces}
      changeUserRole={changeUserRole}
    />
  )
}

describe('AdminUserActions', () => {
  beforeEach(() => {
    listWorkspaces.mockReset()
    listWorkspaces.mockResolvedValue([membership])
    changeUserRole.mockReset()
    changeUserRole.mockResolvedValue({ ...membership.member, role: 'admin' })
  })

  it('loads the memberships and names each role button by its workspace', async () => {
    await renderActions()
    fireEvent.click(screen.getByRole('button', { name: /Load workspaces/ }))
    await screen.findByLabelText('Make Starter Lab role admin')
    expect(screen.getByLabelText('Make Starter Lab role owner')).toBeTruthy()
    // The role the membership already holds is not offered.
    expect(screen.queryByLabelText('Make Starter Lab role member')).toBeNull()
    expect(listWorkspaces).toHaveBeenCalledWith({ data: { userId: 'usr_dev' } })
  })

  it('re-reads the memberships after a role change', async () => {
    await renderActions()
    fireEvent.click(screen.getByRole('button', { name: /Load workspaces/ }))
    fireEvent.click(await screen.findByLabelText('Make Starter Lab role admin'))
    await waitFor(() => {
      expect(changeUserRole).toHaveBeenCalledWith({
        data: { userId: 'usr_dev', workspaceId: 'wrk_1', role: 'admin' }
      })
    })
    await waitFor(() => {
      expect(listWorkspaces).toHaveBeenCalledTimes(2)
    })
  })

  it('says so when the user holds no memberships', async () => {
    listWorkspaces.mockResolvedValue([])
    await renderActions()
    fireEvent.click(screen.getByRole('button', { name: /Load workspaces/ }))
    await screen.findByText('Dev Member holds no workspace memberships.')
  })

  it('shows a failed read as a message instead of an unhandled rejection', async () => {
    listWorkspaces.mockRejectedValue(new Error('Admin session expired'))
    await renderActions()
    fireEvent.click(screen.getByRole('button', { name: /Load workspaces/ }))
    await screen.findByText('Admin session expired')
  })
})
