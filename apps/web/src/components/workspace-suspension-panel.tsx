import { useState } from 'react'

import { ActionFeedback } from '@/components/page/action-feedback'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useServerAction } from '@/hooks/use-server-action'
import { m } from '@b2b-saas-starter/i18n/messages'
import { type WorkspaceSuspension as WorkspaceSuspensionResult } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'

export type WorkspaceSuspension = {
  readonly status: 'active' | 'suspended'
  readonly customerExplanation?: string
  readonly suspendedAt?: string
}

export type SuspendWorkspace = (input: {
  readonly data: {
    readonly workspaceId: string
    readonly internalReason: string
    readonly customerExplanation: string
  }
}) => Promise<WorkspaceSuspensionResult | undefined>

export type ReactivateWorkspace = (input: {
  readonly data: { readonly workspaceId: string; readonly internalReason: string }
}) => Promise<WorkspaceSuspensionResult | undefined>

/**
 * Admin-only lifecycle controls. The two reason fields are deliberately
 * separate: the internal note is retained for audit/support work while the
 * customer explanation is the only copy exposed on the recovery surface.
 */
export function WorkspaceSuspensionPanel({
  workspaceId,
  workspaceName,
  suspension,
  suspend,
  reactivate
}: {
  readonly workspaceId: string
  readonly workspaceName: string
  readonly suspension: WorkspaceSuspension
  readonly suspend: SuspendWorkspace
  readonly reactivate: ReactivateWorkspace
}) {
  const [internalReason, setInternalReason] = useState('')
  const [customerExplanation, setCustomerExplanation] = useState('')
  const active = suspension.status === 'active'

  const change = useServerAction(
    async () => {
      if (active) {
        return suspend({
          data: {
            workspaceId,
            internalReason: internalReason.trim(),
            customerExplanation: customerExplanation.trim()
          }
        })
      }
      return reactivate({
        data: { workspaceId, internalReason: internalReason.trim() }
      })
    },
    {
      failureMessage: active
        ? m.admin_workspace_suspend_failed()
        : m.admin_workspace_reactivate_failed()
    }
  )

  const canSuspend =
    internalReason.trim().length > 0 &&
    (!active || customerExplanation.trim().length > 0)

  return (
    <div className="grid gap-4 rounded-none border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold">{workspaceName}</h3>
          <p className="text-xs text-muted-foreground">
            {active ? m.admin_workspace_active() : m.admin_workspace_suspended()}
          </p>
        </div>
        <Button
          variant={active ? 'destructive' : 'default'}
          disabled={change.pending || !canSuspend}
          onClick={() => change.run()}
        >
          {change.pending ? <Spinner data-icon="inline-start" /> : null}
          {active ? m.admin_workspace_suspend() : m.admin_workspace_reactivate()}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${workspaceId}-internal-reason`}>
            {m.admin_workspace_internal_reason()}
          </Label>
          <Textarea
            id={`${workspaceId}-internal-reason`}
            value={internalReason}
            onChange={(event) => setInternalReason(event.target.value)}
            placeholder={m.admin_workspace_internal_reason_placeholder()}
            aria-describedby={`${workspaceId}-internal-hint`}
          />
          <p
            id={`${workspaceId}-internal-hint`}
            className="text-xs text-muted-foreground"
          >
            {m.admin_workspace_internal_reason_hint()}
          </p>
        </div>
        {active ? (
          <div className="grid gap-2">
            <Label htmlFor={`${workspaceId}-customer-explanation`}>
              {m.admin_workspace_customer_explanation()}
            </Label>
            <Textarea
              id={`${workspaceId}-customer-explanation`}
              value={customerExplanation}
              onChange={(event) => setCustomerExplanation(event.target.value)}
              placeholder={m.admin_workspace_customer_explanation_placeholder()}
              aria-describedby={`${workspaceId}-customer-hint`}
            />
            <p
              id={`${workspaceId}-customer-hint`}
              className="text-xs text-muted-foreground"
            >
              {m.admin_workspace_customer_explanation_hint()}
            </p>
          </div>
        ) : null}
      </div>
      {active ? null : (
        <p className="text-sm text-muted-foreground">
          {m.admin_workspace_suspended_since({
            date: suspension.suspendedAt ?? m.common_unknown()
          })}
        </p>
      )}

      {change.error === null ? null : <ActionFeedback error={change.error} />}
    </div>
  )
}
