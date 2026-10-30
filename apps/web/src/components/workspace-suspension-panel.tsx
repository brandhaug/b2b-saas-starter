import { useForm } from '@tanstack/react-form'

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
  const active = suspension.status === 'active'
  const form = useForm({
    defaultValues: { internalReason: '', customerExplanation: '' },
    validators: {
      onSubmit: ({ value }) =>
        !value.internalReason.trim() || (active && !value.customerExplanation.trim())
          ? m.admin_workspace_internal_reason_hint()
          : undefined
    },
    onSubmit: async ({ value }) => {
      await change.runAsync(value)
    }
  })

  const change = useServerAction(
    async ({
      internalReason,
      customerExplanation
    }: {
      readonly internalReason: string
      readonly customerExplanation: string
    }) => {
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

  return (
    <form
      className="grid gap-4 rounded-none border border-border p-4"
      aria-label={workspaceName}
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const { values, isSubmitting } = form.state
        if (
          isSubmitting ||
          !values.internalReason.trim() ||
          (active && !values.customerExplanation.trim())
        ) {
          return
        }
        void form.handleSubmit()
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 className="text-sm font-semibold">{workspaceName}</h3>
          <p className="text-xs text-muted-foreground">
            {active ? m.admin_workspace_active() : m.admin_workspace_suspended()}
          </p>
        </div>
        <form.Subscribe
          selector={(state) => ({
            values: state.values,
            isSubmitting: state.isSubmitting
          })}
        >
          {({ values, isSubmitting }) => (
            <Button
              type="submit"
              variant={active ? 'destructive' : 'default'}
              disabled={
                isSubmitting ||
                !values.internalReason.trim() ||
                (active && !values.customerExplanation.trim())
              }
            >
              {change.pending ? <Spinner data-icon="inline-start" /> : null}
              {active ? m.admin_workspace_suspend() : m.admin_workspace_reactivate()}
            </Button>
          )}
        </form.Subscribe>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={`${workspaceId}-internal-reason`}>
            {m.admin_workspace_internal_reason()}
          </Label>
          <form.Field name="internalReason">
            {(field) => (
              <Textarea
                id={`${workspaceId}-internal-reason`}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder={m.admin_workspace_internal_reason_placeholder()}
                aria-describedby={`${workspaceId}-internal-hint`}
              />
            )}
          </form.Field>
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
            <form.Field name="customerExplanation">
              {(field) => (
                <Textarea
                  id={`${workspaceId}-customer-explanation`}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder={m.admin_workspace_customer_explanation_placeholder()}
                  aria-describedby={`${workspaceId}-customer-hint`}
                />
              )}
            </form.Field>
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
    </form>
  )
}
