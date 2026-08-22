import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type WorkspaceSettingsPayload } from '@/lib/server/workspace-settings'
import { renderWithRouter } from '@/test/router-harness'
import { type CreateApiToken } from '@/components/api-token-form'
import { type SignOut } from '@/components/workspace-shell'
import { WorkspaceSettingsPage } from './workspaces.$workspaceSlug.settings'

// The page takes its params and loader projection as props, so the test renders
// it directly under a real router: no route tree, no loader, and no mocked
// module. The two server calls its children make arrive as ports.
const createToken = vi.fn<CreateApiToken>()
const signOut = vi.fn<SignOut>()

const settingsSummary: WorkspaceSettingsPayload = {
  viewer: { role: 'owner' },
  apiTokenCount: 3,
  webhookCount: 1,
  unreadCount: 2,
  // The invitation panel renders from the same projection; an empty list is the
  // state a fresh workspace is in.
  invitations: []
}

/**
 * What a `member` receives from the loader: the segments the matrix denies are
 * `null`, because the server never read them (see loadWorkspaceSettings).
 */
const memberSettings: WorkspaceSettingsPayload = {
  ...settingsSummary,
  viewer: { role: 'member' },
  apiTokenCount: null,
  webhookCount: null,
  invitations: null
}

async function renderPage(data: WorkspaceSettingsPayload = settingsSummary) {
  const rendered = await renderWithRouter(
    <WorkspaceSettingsPage
      workspaceSlug="starter-lab"
      data={data}
      ports={{ createToken, signOut }}
    />,
    { path: '/workspaces/starter-lab/settings', destinations: ['/sign-in'] }
  )
  await screen.findByRole('heading', { name: 'Workspace settings' })
  return rendered
}

describe('WorkspaceSettingsPage', () => {
  it('renders the operational counts from the loader projection', async () => {
    await renderPage()
    screen.getByText(/3 workspace-scoped tokens are seeded/)
    screen.getByText(/1 endpoint is configured/)
    // Unread-notification badge in the shell header.
    screen.getByText('2')
  })

  it('renders the api token form scoped to the current workspace', async () => {
    await renderPage()
    screen.getByLabelText('Token name')
    screen.getByRole('button', { name: 'Create token' })
  })
})

describe('WorkspaceSettingsPage as a member', () => {
  it('does not render the api token section', async () => {
    await renderPage(memberSettings)
    expect(screen.queryByText('API tokens')).toBeNull()
    expect(screen.queryByLabelText('Token name')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Create token' })).toBeNull()
  })

  it('does not render the members or webhook sections', async () => {
    await renderPage(memberSettings)
    expect(screen.queryByText('Members')).toBeNull()
    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(screen.queryByText('Outbound webhooks')).toBeNull()
  })
})
