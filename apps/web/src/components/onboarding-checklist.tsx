import {
  type WorkspaceProgressProjection,
  type WorkspaceProgressStepId
} from '@b2b-saas-starter/capabilities/workspace-projections'
import { Link } from '@tanstack/react-router'
import { CircleCheckIcon, CircleIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useServerAction } from '@/hooks/use-server-action'
import { viewerCan, type Viewer } from '@/lib/permissions'
import { dismissOnboardingChecklistServerFn } from '@/lib/server/workspace-onboarding'
import { type WorkspaceNavTarget } from '@/lib/workspace-nav'

const DISMISS_FAILED = 'Failed to dismiss the checklist'

/**
 * Dismissing, as a port. Injected so a test drives the card with a real
 * function of this shape instead of replacing the module it lives in; every
 * caller but a test passes nothing and gets the production server function.
 */
export type DismissOnboardingChecklist = (input: {
  readonly data: { readonly workspaceSlug: string }
}) => Promise<boolean>

/**
 * Where each step is completed. The projection owns the step vocabulary and
 * the completion facts; the web app owns labels and destinations, the way it
 * owns audit-event labels.
 */
const STEP_COPY = {
  invite_member: { label: 'Invite a member', to: '/workspaces/$workspaceSlug/members' },
  create_api_token: {
    label: 'Create an API token',
    to: '/workspaces/$workspaceSlug/api-tokens'
  },
  add_webhook_endpoint: {
    label: 'Add a webhook endpoint',
    to: '/workspaces/$workspaceSlug/webhooks'
  },
  enable_two_factor: { label: 'Enable two-factor on your account', to: '/account' },
  choose_plan: { label: 'Choose a plan', to: '/workspaces/$workspaceSlug/billing' }
} satisfies Record<
  WorkspaceProgressStepId,
  { readonly label: string; readonly to: WorkspaceNavTarget | '/account' }
>

function StepLink({
  to,
  workspaceSlug,
  children
}: {
  readonly to: WorkspaceNavTarget | '/account'
  readonly workspaceSlug: string
  readonly children: string
}) {
  const className = 'underline-offset-4 hover:underline'
  if (to === '/account') {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    )
  }
  return (
    <Link to={to} params={{ workspaceSlug }} className={className}>
      {children}
    </Link>
  )
}

/** The one-line confirmation the card becomes right after a dismissal. */
export function OnboardingChecklistDismissed() {
  return (
    // `role="status"`: a quiet confirmation of the click, not an interruption.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see above
    <p role="status" className="text-sm text-muted-foreground">
      Setup checklist hidden for this workspace.
    </p>
  )
}

/**
 * The workspace onboarding checklist: a quiet card listing what a new
 * workspace usually sets up, ticked from live capability state — nothing here
 * is remembered except the dismissal. Incomplete steps link to the page that
 * completes them. Owners and admins can dismiss it for the workspace; members
 * see it read-only. Renders nothing once dismissed.
 */
export function OnboardingChecklist({
  workspaceSlug,
  progress,
  viewer,
  dismiss = dismissOnboardingChecklistServerFn
}: {
  readonly workspaceSlug: string
  readonly progress: WorkspaceProgressProjection
  readonly viewer: Viewer
  readonly dismiss?: DismissOnboardingChecklist
}) {
  const [justDismissed, setJustDismissed] = useState(false)
  const canDismiss = viewerCan(viewer, { onboarding: ['dismiss'] })

  // The loader owns `dismissedAt`; the hook re-runs it on success. The local
  // flag only bridges the moment between the click and the refreshed payload.
  const dismissal = useServerAction(() => dismiss({ data: { workspaceSlug } }), {
    failureMessage: DISMISS_FAILED,
    onSuccess: () => setJustDismissed(true)
  })

  if (justDismissed) {
    return <OnboardingChecklistDismissed />
  }
  if (progress.dismissedAt !== null) {
    return null
  }

  const allDone = progress.completedCount === progress.totalCount

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Set up your workspace</CardTitle>
        <p className="text-sm text-muted-foreground">
          {allDone
            ? 'Every step is done. Dismiss this card whenever you like.'
            : 'Each step is checked against the workspace itself, so it reopens if the thing behind it is removed.'}
        </p>
        <div data-slot="card-action" className="flex items-center gap-3">
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {progress.completedCount} of {progress.totalCount}
          </span>
          {canDismiss ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={dismissal.pending}
              onClick={() => dismissal.run()}
            >
              Dismiss
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <ul className="grid gap-2 text-sm">
          {progress.steps.map((step) => {
            const copy = STEP_COPY[step.id]
            return (
              <li key={step.id} className="flex items-center gap-2">
                {step.complete ? (
                  <CircleCheckIcon
                    aria-label="Done"
                    className="size-4 shrink-0 text-status-ok"
                  />
                ) : (
                  <CircleIcon
                    aria-label="To do"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                )}
                {step.complete ? (
                  <span className="text-muted-foreground">{copy.label}</span>
                ) : (
                  <StepLink to={copy.to} workspaceSlug={workspaceSlug}>
                    {copy.label}
                  </StepLink>
                )}
              </li>
            )
          })}
        </ul>
        {canDismiss ? null : (
          <p className="text-xs text-muted-foreground">
            Owners and admins can dismiss this checklist for the workspace.
          </p>
        )}
        {dismissal.error ? (
          <p role="alert" className="text-xs text-destructive">
            {dismissal.error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
