import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type WorkspaceSettingsSummaryProjection } from '@b2b-saas-starter/capabilities'
import { renderWithRouter } from '@/test/router-harness'
import { type CreateApiToken } from '@/components/api-token-form'
import { type SignOut } from '@/components/workspace-shell'
import { WorkspaceSettingsPage } from './workspaces.$workspaceSlug.settings'

// The page takes its params and loader projection as props, so the test renders
// it directly under a real router: no route tree, no loader, and no mocked
// module. The two server calls its children make arrive as ports.
const createToken = vi.fn<CreateApiToken>()
const signOut = vi.fn<SignOut>()

const settingsSummary: WorkspaceSettingsSummaryProjection = {
  modules: [
    {
      id: 'effect-v4',
      name: 'Effect v4',
      category: 'architecture',
      summary: 'Typed services, schemas, and HTTP contracts.',
      docsPath: '/docs/architecture/effect-v4',
      optional: false,
      state: {
        moduleId: 'effect-v4',
        enabled: true,
        status: 'ready',
        missingConfig: [],
        updatedAt: '2026-06-01T00:00:00.000Z'
      }
    },
    {
      id: 'email-reports',
      name: 'Email reports',
      category: 'notifications',
      summary: 'Weekly implementation reports through Cloudflare Email.',
      docsPath: '/docs/modules/email-reports',
      optional: true,
      state: {
        moduleId: 'email-reports',
        enabled: false,
        status: 'needs-config',
        missingConfig: ['EMAIL_FROM'],
        updatedAt: '2026-06-01T00:00:00.000Z'
      }
    }
  ],
  apiTokenCount: 3,
  webhookCount: 1,
  unreadCount: 2,
  // The invitation panel renders from the same projection; an empty list is the
  // state a fresh workspace is in.
  invitations: []
}

async function renderPage() {
  const rendered = await renderWithRouter(
    <WorkspaceSettingsPage
      workspaceSlug="starter-lab"
      data={settingsSummary}
      ports={{ createToken, signOut }}
    />,
    { path: '/workspaces/starter-lab/settings', destinations: ['/sign-in'] }
  )
  await screen.findByRole('heading', { name: 'Workspace settings' })
  return rendered
}

describe('WorkspaceSettingsPage', () => {
  it('renders each module with its status badge, including needs-config', async () => {
    await renderPage()
    screen.getByText('Effect v4')
    screen.getByText('ready')
    screen.getByText('Email reports')
    screen.getByText('needs-config')
  })

  it('renders module toggles that reflect enabled state and stay read-only', async () => {
    await renderPage()
    const switches = screen.getAllByRole('switch')
    expect(switches).toHaveLength(2)
    const [readyToggle, needsConfigToggle] = switches
    expect(readyToggle?.getAttribute('aria-checked')).toBe('true')
    expect(needsConfigToggle?.getAttribute('aria-checked')).toBe('false')
    for (const toggle of switches) {
      // Base UI marks disabled controls with data-disabled.
      expect(toggle.hasAttribute('data-disabled')).toBe(true)
    }
  })

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
