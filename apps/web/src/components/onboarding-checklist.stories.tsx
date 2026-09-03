import {
  WORKSPACE_PROGRESS_STEPS,
  type WorkspaceProgressProjection,
  type WorkspaceProgressStepId
} from '@b2b-saas-starter/capabilities/workspace-projections'
import { type Meta, type StoryObj } from '@storybook/react-vite'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider
} from '@tanstack/react-router'
import { type ReactNode } from 'react'

import {
  OnboardingChecklist,
  OnboardingChecklistDismissed,
  type DismissOnboardingChecklist
} from '@/components/onboarding-checklist'
import { type Viewer } from '@/lib/permissions'

/**
 * The step links are real router `Link`s and the dismiss button runs through
 * `useServerAction`, so each story renders inside a memory-history router and
 * a query client — the same two providers the page has in production.
 */
function StoryProviders({ children }: { readonly children: ReactNode }) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => children }),
    history: createMemoryHistory({ initialEntries: ['/'] })
  })
  return (
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

// A dismiss port that resolves without a server: clicking "Dismiss" in an
// owner story shows the confirmation state.
function dismiss(): ReturnType<DismissOnboardingChecklist> {
  return Promise.resolve(true)
}

const OWNER: Viewer = { role: 'owner' }
const MEMBER: Viewer = { role: 'member' }

function progressOf(
  done: ReadonlyArray<WorkspaceProgressStepId>,
  dismissedAt: string | null = null
): WorkspaceProgressProjection {
  const steps = WORKSPACE_PROGRESS_STEPS.map((id) => ({
    id,
    complete: done.includes(id)
  }))
  return {
    steps,
    completedCount: steps.filter((step) => step.complete).length,
    totalCount: steps.length,
    dismissedAt
  }
}

function ChecklistCard({
  progress,
  viewer
}: {
  readonly progress: WorkspaceProgressProjection
  readonly viewer: Viewer
}) {
  return (
    <StoryProviders>
      <div className="w-128">
        <OnboardingChecklist
          workspaceSlug="starter-lab"
          progress={progress}
          viewer={viewer}
          dismiss={dismiss}
        />
      </div>
    </StoryProviders>
  )
}

const meta = {
  title: 'Workspace/OnboardingChecklist',
  component: ChecklistCard
} satisfies Meta<typeof ChecklistCard>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: { progress: progressOf([]), viewer: OWNER }
}

/** The Seed Workspace's shape: three of five, two-factor and plan still open. */
export const Partial: Story = {
  args: {
    progress: progressOf(['invite_member', 'create_api_token', 'add_webhook_endpoint']),
    viewer: OWNER
  }
}

export const Complete: Story = {
  args: {
    progress: progressOf([
      'invite_member',
      'create_api_token',
      'add_webhook_endpoint',
      'enable_two_factor',
      'choose_plan'
    ]),
    viewer: OWNER
  }
}

/** A member sees the same steps, read-only: no dismiss control, a reason instead. */
export const MemberReadOnly: Story = {
  args: {
    progress: progressOf(['invite_member']),
    viewer: MEMBER
  }
}

/** What the card becomes the moment after "Dismiss" succeeds. On the next load it is gone. */
export const Dismissed: Story = {
  args: { progress: progressOf([]), viewer: OWNER },
  render: () => (
    <div className="w-128">
      <OnboardingChecklistDismissed />
    </div>
  )
}
