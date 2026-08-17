import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { Cause, Effect, Exit, Option } from 'effect'
import {
  WORKSPACE_ROLES,
  type Invitation,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities'
import { FormTextField } from '@/components/form-text-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  cancelInvitationServerFn,
  sendInvitationServerFn,
  type SentInvitation
} from '@/lib/server/invitations'

const SEND_FAILED = 'Failed to send the invitation'
const CANCEL_FAILED = 'Failed to cancel the invitation'

type InvitationValues = {
  email: string
  role: WorkspaceRole
}

const DEFAULT_INVITATION_VALUES: InvitationValues = {
  email: '',
  role: 'member'
}

function validateEmail(value: string): string | undefined {
  if (value.trim().length === 0) return 'Email is required'
  if (!/^[^\s@]+@[^\s@]+$/.test(value)) return 'Enter a valid email address'
  return
}

type BadgeVariant = 'default' | 'secondary' | 'outline'

/** `pending` is the only status a workspace can still act on, so it leads. */
function statusVariant(status: Invitation['status']): BadgeVariant {
  if (status === 'pending') return 'default'
  if (status === 'accepted') return 'secondary'
  return 'outline'
}

export function InvitationPanel({
  workspaceSlug,
  invitations
}: {
  readonly workspaceSlug: string
  readonly invitations: readonly Invitation[]
}) {
  const router = useRouter()
  const [sent, setSent] = useState<SentInvitation | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const form = useForm({
    defaultValues: DEFAULT_INVITATION_VALUES,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      // Same shape as `ApiTokenForm`: the server function rejects on failure and
      // `Effect.tryPromise` turns that rejection into a display message, so the
      // failure path is a value rather than a try/catch.
      const exit = await Effect.runPromiseExit(
        Effect.tryPromise({
          try: () =>
            sendInvitationServerFn({
              data: { workspaceSlug, email: value.email, role: value.role }
            }),
          catch: (cause) => (cause instanceof Error ? cause.message : SEND_FAILED)
        })
      )
      if (Exit.isFailure(exit)) {
        setSubmitError(
          Option.getOrElse(Cause.findErrorOption(exit.cause), () => SEND_FAILED)
        )
        return
      }
      setSent(exit.value)
      form.reset()
      // The loader owns the invitation list, so re-run it rather than mirroring
      // the new row into local state.
      await router.invalidate()
    }
  })

  async function cancel(invitationId: string) {
    setCancelError(null)
    setCancelling(invitationId)
    const exit = await Effect.runPromiseExit(
      Effect.tryPromise({
        try: () => cancelInvitationServerFn({ data: { workspaceSlug, invitationId } }),
        catch: (cause) => (cause instanceof Error ? cause.message : CANCEL_FAILED)
      })
    )
    setCancelling(null)
    if (Exit.isFailure(exit)) {
      setCancelError(
        Option.getOrElse(Cause.findErrorOption(exit.cause), () => CANCEL_FAILED)
      )
      return
    }
    await router.invalidate()
  }

  return (
    <div className="grid gap-5">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
        className="grid gap-4"
      >
        <form.Field
          name="email"
          validators={{ onChange: ({ value }) => validateEmail(value) }}
        >
          {(field) => (
            <FormTextField
              name={field.name}
              label="Invite by email"
              value={field.state.value}
              errors={field.state.meta.errors}
              onBlur={field.handleBlur}
              onChange={field.handleChange}
              placeholder="teammate@example.com"
            />
          )}
        </form.Field>

        <form.Field name="role">
          {(field) => (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium leading-none">Role</legend>
              <div className="flex flex-wrap gap-3">
                {WORKSPACE_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={field.name}
                      value={role}
                      checked={field.state.value === role}
                      onChange={() => field.handleChange(role)}
                    />
                    <span>{role}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </form.Field>

        <form.Subscribe
          selector={(state): readonly [boolean, boolean] => [
            state.canSubmit,
            state.isSubmitting
          ]}
        >
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" disabled={!canSubmit} className="justify-self-start">
              {isSubmitting ? 'Sending…' : 'Send invitation'}
            </Button>
          )}
        </form.Subscribe>

        {sent ? (
          <div className="grid gap-1 rounded-md border border-border bg-muted/40 p-3 text-xs">
            <p className="font-medium">
              {sent.delivered
                ? `Invitation sent to ${sent.invitation.email}.`
                : `Invitation created for ${sent.invitation.email}, but the email could not be sent — share this link instead.`}
            </p>
            <code className="break-all">{sent.inviteUrl}</code>
          </div>
        ) : null}
        {submitError ? (
          <p className="text-xs text-destructive" role="alert">
            {submitError}
          </p>
        ) : null}
      </form>

      <div className="grid gap-2">
        <p className="text-sm font-medium">Invitations</p>
        {invitations.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No invitations yet. Invite someone above.
          </p>
        ) : (
          <ul className="grid gap-2">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
              >
                <div className="grid gap-0.5">
                  <p className="text-sm font-medium">{invitation.email}</p>
                  <p className="text-xs text-muted-foreground">{invitation.role}</p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={statusVariant(invitation.status)}>
                    {invitation.status}
                  </Badge>
                  {invitation.status === 'pending' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={cancelling === invitation.id}
                      onClick={() => void cancel(invitation.id)}
                    >
                      {cancelling === invitation.id ? 'Cancelling…' : 'Cancel'}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {cancelError ? (
          <p className="text-xs text-destructive" role="alert">
            {cancelError}
          </p>
        ) : null}
      </div>
    </div>
  )
}
