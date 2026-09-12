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
import { cn } from '@/lib/utils'
import { type WorkspaceView } from '@/lib/workspace-view'

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
      to: '/workspaces/$workspaceSlug/members',
      search: { action: 'invite' }
    },
    create_api_token: {
      label: m.onboarding_create_api_token(),
      to: '/workspaces/$workspaceSlug/api-tokens',
      search: { action: 'create' }
    },
    add_webhook_endpoint: {
      label: m.onboarding_add_webhook_endpoint(),
      to: '/workspaces/$workspaceSlug/webhooks',
      search: { action: 'create' }
    },
    enable_two_factor: {
      label: m.onboarding_enable_two_factor(),
      to: '/account',
      search: {}
    },
    choose_plan: {
      label: m.onboarding_choose_plan(),
      to: '/workspaces/$workspaceSlug/billing',
      search: {}
    }
  } satisfies Record<
    WorkspaceProgressStepId,
    {
      readonly label: string
      readonly to: WorkspaceNavTarget | '/account'
      readonly search: WorkspaceView
    }
  >
}

function StepLink({
  to,
  workspaceSlug,
  search,
  className: linkClassName,
  children
}: {
  readonly to: WorkspaceNavTarget | '/account'
  readonly workspaceSlug: string
  readonly search?: WorkspaceView
  readonly className?: string
  readonly children: string
}) {
  const preview = usePreview()
  const className = cn('underline-offset-4 hover:underline', linkClassName)
  if (to === '/account') {
    return preview ? (
      <Link to="/sign-in" className={className}>
        {m.demo_try_sign_in()}
      </Link>
    ) : (
      <Link to={to} className={className}>
        {children}
      </Link>
    )
  }
  return (
    <WorkspaceLink
      to={to}
      workspaceSlug={workspaceSlug}
      search={search}
      className={className}
    >
      {children}
    </WorkspaceLink>
  )
}

/** The one-line confirmation the card becomes right after a dismissal. */
function OnboardingChecklistDismissed() {
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
  const preview = usePreview()
  const [justDismissed, setJustDismissed] = useState(false)
  const canDismiss = viewerCan(viewer, { onboarding: ['dismiss'] })
  const canInvite = viewerCan(viewer, { invitation: ['create'] })
  const canManageWorkspace = canInvite
  const canCreateToken = viewerCan(viewer, { apiToken: ['create'] })
  const canCreateWebhook = viewerCan(viewer, { webhook: ['create'] })
  const canReadAudit = viewerCan(viewer, { auditLog: ['read'] })
  const requiredIds = canInvite
    ? new Set<WorkspaceProgressStepId>(['invite_member', 'enable_two_factor'])
    : new Set<WorkspaceProgressStepId>(['enable_two_factor'])
  const requiredSteps = progress.steps
    .filter((step) => requiredIds.has(step.id))
    .toSorted((a, b) => Number(a.complete) - Number(b.complete))

  // The loader owns `dismissedAt`; the hook re-runs it on success. The local
  // flag only bridges the moment between the click and the refreshed payload.
  const dismissal = useServerAction(() => dismiss({ data: { workspaceSlug } }), {
    failureMessage: m.dismiss_checklist_failed(),
    onSuccess: () => setJustDismissed(true)
  })

  if (justDismissed) {
    return <OnboardingChecklistDismissed />
  }
  if (progress.dismissedAt !== null) {
    return null
  }

  const completedCount = requiredSteps.filter((step) => step.complete).length
  const allDone = completedCount === requiredSteps.length

  return (
    <Panel
      title={m.setup_workspace()}
      {...(allDone ? { description: m.setup_workspace_complete() } : {})}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm tabular-nums text-muted-foreground">
          {m.onboarding_progress({
            completedCount,
            totalCount: requiredSteps.length
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
      </div>
      <ul className="grid gap-2 text-sm">
        {requiredSteps.map((step, index) => {
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
                <StepLink
                  to={copy.to}
                  workspaceSlug={workspaceSlug}
                  search={copy.search}
                  {...(index === requiredSteps.findIndex((item) => !item.complete)
                    ? { className: 'font-medium' }
                    : {})}
                >
                  {copy.label}
                </StepLink>
              )}
            </li>
          )
        })}
      </ul>
      {canManageWorkspace ? null : (
        <div className="grid gap-2 border-t border-border pt-4 text-sm">
          <p className="text-muted-foreground">{m.onboarding_member_orientation()}</p>
          <div className="flex flex-wrap gap-4">
            <WorkspaceLink
              to="/workspaces/$workspaceSlug/members"
              workspaceSlug={workspaceSlug}
              className="underline underline-offset-4"
            >
              {m.onboarding_meet_team()}
            </WorkspaceLink>
            {preview ? (
              <Link
                to="/demo/$section"
                params={{ section: 'notifications' }}
                className="underline underline-offset-4"
              >
                {m.notifications_title()}
              </Link>
            ) : (
              <Link
                to="/account/notifications"
                className="underline underline-offset-4"
              >
                {m.notifications_title()}
              </Link>
            )}
          </div>
        </div>
      )}
      {canManageWorkspace && (canCreateToken || canCreateWebhook || canReadAudit) ? (
        <div className="grid gap-2 border-t border-border pt-4 text-sm">
          <p className="text-muted-foreground">
            {m.onboarding_optional_integrations()}
          </p>
          <p className="text-sm text-muted-foreground">
            {m.onboarding_workflow_guidance()}
          </p>
          <p className="text-sm text-muted-foreground">
            <Link
              to="/docs/$category/$slug"
              params={{ category: 'capability-interfaces', slug: 'api-tokens' }}
              className="underline underline-offset-4 hover:no-underline"
            >
              {m.onboarding_api_docs()}
            </Link>
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {canCreateToken ? (
              <WorkspaceLink
                to="/workspaces/$workspaceSlug/api-tokens"
                search={{ action: 'create' }}
                workspaceSlug={workspaceSlug}
                className="underline underline-offset-4 hover:no-underline"
              >
                {m.onboarding_create_api_token()}
              </WorkspaceLink>
            ) : null}
            {canCreateWebhook ? (
              <WorkspaceLink
                to="/workspaces/$workspaceSlug/webhooks"
                search={{ action: 'create' }}
                workspaceSlug={workspaceSlug}
                className="underline underline-offset-4 hover:no-underline"
              >
                {m.onboarding_add_webhook_endpoint()}
              </WorkspaceLink>
            ) : null}
            {canReadAudit ? (
              <WorkspaceLink
                to="/workspaces/$workspaceSlug/audit"
                workspaceSlug={workspaceSlug}
                className="underline underline-offset-4 hover:no-underline"
              >
                {m.onboarding_review_audit()}
              </WorkspaceLink>
            ) : null}
          </div>
        </div>
      ) : null}
      {canDismiss || !dismissalHint ? null : (
        <p className="text-xs text-muted-foreground">{dismissalHint}</p>
      )}
      <ActionFeedback error={dismissal.error} />
    </Panel>
  )
}
