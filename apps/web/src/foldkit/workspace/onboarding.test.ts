// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vite-plus/test'
import { demoFixtures } from '@/lib/demo-fixtures'
import * as Dashboard from '@/lib/server/workspace-dashboard'
import * as Onboarding from '@/lib/server/workspace-onboarding'
import { renderWorkspace } from './test-harness'

const progress = {
  steps: [
    { id: 'invite_member' as const, complete: true },
    { id: 'create_api_token' as const, complete: false },
    { id: 'enable_two_factor' as const, complete: false }
  ],
  completedCount: 1,
  totalCount: 3,
  dismissedAt: null
}
function renderChecklist(
  role: 'owner' | 'member',
  dismissedAt: string | null = null,
  preview = false
) {
  return renderWorkspace(
    {
      _tag: 'dashboard',
      data: {
        ...demoFixtures.dashboard,
        viewer: { role },
        progress: { ...progress, dismissedAt }
      }
    },
    { preview }
  )
}
describe('onboarding preserved behaviors', () => {
  it('counts progress and links only the open steps', async () => {
    await renderChecklist('owner')
    expect(screen.getByText('1 of 2')).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'Invite a member' })).toBeNull()
    expect(
      screen
        .getByRole('link', { name: 'Enable two-factor on your account' })
        .getAttribute('href')
    ).toBe('/account')
    fireEvent.click(screen.getByText('Developer setup'))
    expect(screen.getByRole('link', { name: 'Create an API token' })).not.toBeNull()
  })

  it('lets an owner dismiss and confirms it', async () => {
    const dismiss = vi
      .spyOn(Onboarding, 'dismissOnboardingChecklistServerFn')
      .mockResolvedValue(true)
    vi.spyOn(Dashboard, 'loadWorkspaceDashboardServerFn').mockResolvedValue({
      ...demoFixtures.dashboard,
      progress: { ...progress, dismissedAt: '2026-09-01T10:00:00.000Z' }
    })
    await renderChecklist('owner')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await screen.findByText('Setup checklist hidden for this workspace.')
    expect(dismiss).toHaveBeenCalledWith({ data: { workspaceSlug: 'starter-lab' } })
    expect(screen.queryByText('Set up your workspace')).toBeNull()
  })

  it('shows a member the steps read-only', async () => {
    await renderChecklist('member')
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    screen.getByText('Owners and admins can dismiss this checklist for the workspace.')
    expect(
      screen.getByRole('link', { name: 'Meet your team' }).getAttribute('href')
    ).toBe('/workspaces/starter-lab/members')
    expect(
      screen.getByRole('link', { name: 'Notifications' }).getAttribute('href')
    ).toBe('/account/notifications')
  })

  it('omits the member dismissal note in the preview and hides developer mutations', async () => {
    await renderChecklist('member', null, true)
    expect(
      screen.queryByText(
        'Owners and admins can dismiss this checklist for the workspace.'
      )
    ).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Enable two-factor on your account' })
    ).not.toBeNull()
    expect(screen.queryByRole('link', { name: 'Create an API token' })).toBeNull()
  })

  it('renders nothing once dismissed', async () => {
    await renderChecklist('owner', '2026-09-01T10:00:00.000Z')
    expect(screen.queryByText('Set up your workspace')).toBeNull()
  })
})
