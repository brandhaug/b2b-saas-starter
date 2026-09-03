import { type WorkspaceProgressProjection } from '@b2b-saas-starter/capabilities/workspace-projections'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'

import {
  OnboardingChecklist,
  type DismissOnboardingChecklist
} from '@/components/onboarding-checklist'
import { renderWithRouter } from '@/test/router-harness'

const progress: WorkspaceProgressProjection = {
  steps: [
    { id: 'invite_member', complete: true },
    { id: 'create_api_token', complete: false },
    { id: 'enable_two_factor', complete: false }
  ],
  completedCount: 1,
  totalCount: 3,
  dismissedAt: null
}

async function renderChecklist(
  viewer: { readonly role: 'owner' | 'member' },
  dismiss: DismissOnboardingChecklist,
  data: WorkspaceProgressProjection = progress
) {
  return renderWithRouter(
    <OnboardingChecklist
      workspaceSlug="starter-lab"
      progress={data}
      viewer={viewer}
      dismiss={dismiss}
    />,
    {
      path: '/workspaces/starter-lab',
      destinations: ['/workspaces/starter-lab/api-tokens', '/account']
    }
  )
}

describe('OnboardingChecklist', () => {
  it('counts progress and links only the open steps', async () => {
    await renderChecklist(
      { role: 'owner' },
      vi.fn(async () => true)
    )
    screen.getByText('1 of 3')
    expect(screen.queryByRole('link', { name: 'Invite a member' })).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Create an API token' }).getAttribute('href')
    ).toBe('/workspaces/starter-lab/api-tokens')
    expect(
      screen
        .getByRole('link', { name: 'Enable two-factor on your account' })
        .getAttribute('href')
    ).toBe('/account')
  })

  it('lets an owner dismiss and confirms it', async () => {
    const dismiss = vi.fn<DismissOnboardingChecklist>(async () => true)
    await renderChecklist({ role: 'owner' }, dismiss)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await screen.findByRole('status')
    expect(dismiss).toHaveBeenCalledWith({ data: { workspaceSlug: 'starter-lab' } })
    expect(screen.queryByText('Set up your workspace')).toBeNull()
  })

  it('shows a member the steps read-only', async () => {
    await renderChecklist(
      { role: 'member' },
      vi.fn(async () => true)
    )
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull()
    screen.getByText('Owners and admins can dismiss this checklist for the workspace.')
  })

  it('renders nothing once dismissed', async () => {
    await renderChecklist(
      { role: 'owner' },
      vi.fn(async () => true),
      {
        ...progress,
        dismissedAt: '2026-09-01T10:00:00.000Z'
      }
    )
    expect(screen.queryByText('Set up your workspace')).toBeNull()
  })
})
