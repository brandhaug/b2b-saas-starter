import {
  type WorkspaceProgressProjection,
  type WorkspaceProgressStepId
} from '@b2b-saas-starter/capabilities/workspace-projections'
import { Link } from '@tanstack/react-router'
import { WorkspaceLink } from '@/components/workspace-link'
import { usePreview } from '@/lib/preview-context'
import { CircleCheckIcon, CircleIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { useServerAction } from '@/hooks/use-server-action'
import { ActionFeedback } from '@/components/page/action-feedback'
import { Panel } from '@/components/page/panel'
import { viewerCan, type Viewer } from '@/lib/permissions'
import { dismissOnboardingChecklistServerFn } from '@/lib/server/workspace-onboarding'
import { type WorkspaceNavTarget } from '@/lib/workspace-nav'
import { m } from '@b2b-saas-starter/i18n/messages'

function dismissFailedMessage() {
  return m.dismiss_checklist_failed()
}

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
function stepCopy() {
  return {
    invite_member: {
      label: m.onboarding_invite_member(),
      to: '/workspaces/$workspaceSlug/members'
    },
    create_api_token: {
      label: m.onboarding_create_api_token(),
      to: '/workspaces/$workspaceSlug/api-tokens'
    },
    add_webhook_endpoint: {
      label: m.onboarding_add_webhook_endpoint(),
      to: '/workspaces/$workspaceSlug/webhooks'
    },
    enable_two_factor: { label: m.onboarding_enable_two_factor(), to: '/account' },
    choose_plan: {
      label: m.onboarding_choose_plan(),
      to: '/workspaces/$workspaceSlug/billing'
    }
  } satisfies Record<
    WorkspaceProgressStepId,
    { readonly label: string; readonly to: WorkspaceNavTarget | '/account' }
  >
}

function StepLink({
  to,
  workspaceSlug,
  children
}: {
  readonly to: WorkspaceNavTarget | '/account'
  readonly workspaceSlug: string
  readonly children: string
}) {
  const preview = usePreview()
  const className = 'underline-offset-4 hover:underline'
  if (to === '/account') {
    return (
      <Link to={preview ? '/sign-in' : to} className={className}>
        {preview ? m.demo_try_sign_in() : children}
      </Link>
    )
  }
  return (
    <WorkspaceLink to={to} workspaceSlug={workspaceSlug} className={className}>
      {children}
    </WorkspaceLink>
  )
}

/** The one-line confirmation the card becomes right after a dismissal. */
export function OnboardingChecklistDismissed() {
  return (
    // `role="status"`: a quiet confirmation of the click, not an interruption.
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see above
    <p role="status" className="text-sm text-muted-foreground">
      {m.setup_checklist_hidden()}
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
  dismiss = dismissOnboardingChecklistServerFn,
  dismissalHint = m.onboarding_dismiss_owner_note()
}: {
  readonly workspaceSlug: string
  readonly progress: WorkspaceProgressProjection
  readonly viewer: Viewer
  readonly dismiss?: DismissOnboardingChecklist
  /**
   * Optional explanation for viewers without dismissal permission.
   * The read-only demo supplies null because it has no dismiss control.
   */
  readonly dismissalHint?: ReactNode
}) {
  const [justDismissed, setJustDismissed] = useState(false)
  const canDismiss = viewerCan(viewer, { onboarding: ['dismiss'] })

  // The loader owns `dismissedAt`; the hook re-runs it on success. The local
  // flag only bridges the moment between the click and the refreshed payload.
  const dismissal = useServerAction(() => dismiss({ data: { workspaceSlug } }), {
    failureMessage: dismissFailedMessage(),
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
    // The page Panel anatomy, not a hand-rolled Card: the title owns its row
    // and wraps to full width on a phone, and the action slot is Panel's own,
    // so the count and Dismiss can never squeeze the title to three lines.
    <Panel
      title={m.setup_workspace()}
      description={
        allDone ? m.setup_workspace_complete() : m.setup_workspace_description()
      }
      actions={
        <>
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {m.onboarding_progress({
              completedCount: progress.completedCount,
              totalCount: progress.totalCount
            })}
          </span>
          {canDismiss ? (
            <Button
              type="button"
              variant="ghost"
              disabled={dismissal.pending}
              onClick={() => dismissal.run()}
            >
              {m.dismiss_action()}
            </Button>
          ) : null}
        </>
      }
    >
      <ul className="grid gap-2 text-sm">
        {progress.steps.map((step) => {
          const copy = stepCopy()[step.id]
          return (
            <li key={step.id} className="flex items-center gap-2">
              {step.complete ? (
                <CircleCheckIcon
                  aria-label={m.common_done()}
                  className="size-4 shrink-0 text-status-ok"
                />
              ) : (
                <CircleIcon
                  aria-label={m.common_to_do()}
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
      {canDismiss || !dismissalHint ? null : (
        <p className="text-xs text-muted-foreground">{dismissalHint}</p>
      )}
      <ActionFeedback error={dismissal.error} />
    </Panel>
  )
}
