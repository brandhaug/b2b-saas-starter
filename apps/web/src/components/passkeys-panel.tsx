import { useState } from 'react'
import { authClient } from '@/lib/auth-client'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ActionFeedback } from '@/components/page/action-feedback'
import { useServerAction } from '@/hooks/use-server-action'
import { useAuthClientAction, useAuthClientRows } from '@/hooks/use-auth-client-rows'
import { unwrapAuthResult } from '@/lib/auth-result'
import { formatTimestamp } from '@/lib/format-date'
import { m } from '@b2b-saas-starter/i18n/messages'

const PASSKEYS_QUERY_KEY: ReadonlyArray<unknown> = ['account', 'passkeys']

/** One Better Auth passkey row, as the panel reads it. */
type PasskeyRecord = {
  readonly id: string
  readonly name?: string | null | undefined
  readonly createdAt: Date
  readonly backedUp: boolean
}

/** One row of the panel's own view model — dates formatted client-side only. */
type PasskeyRowView = {
  readonly id: string
  readonly label: string
  readonly synced: boolean
  readonly createdLabel: string
}

function describeLabel(passkey: PasskeyRecord): string {
  const trimmed = passkey.name?.trim()
  if (trimmed !== undefined && trimmed.length > 0) {
    return trimmed
  }
  // Unnamed credentials (a ceremony that carried no label) still need a row
  // the user can reason about; the honest label is just "Passkey".
  return m.passkey()
}

function toViewModels(passkeys: ReadonlyArray<PasskeyRecord>): Array<PasskeyRowView> {
  return passkeys
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((passkey) => ({
      id: passkey.id,
      label: describeLabel(passkey),
      synced: passkey.backedUp,
      createdLabel: formatTimestamp(passkey.createdAt, { dateStyle: 'medium' })
    }))
}

/**
 * Passkey management for the signed-in user: register (with a user-chosen
 * name), rename, and remove. Registering runs a WebAuthn ceremony the browser
 * mediates — the panel's own state covers only the label and the list around
 * it. Body of the route's `Panel` (which owns the title), with the same shape
 * as `SessionsPanel`: the list is this panel's own query (not a loader's), so
 * actions refetch it instead of invalidating the route, and every failure
 * reads through `ActionFeedback`.
 */
export function PasskeysPanel() {
  const { hydrated, rows, loadError, isPending, refetch } = useAuthClientRows({
    queryKey: PASSKEYS_QUERY_KEY,
    list: () => authClient.passkey.listUserPasskeys(),
    toRows: toViewModels,
    loadFailedMessage: m.load_passkeys_failed()
  })
  // The passkey list is this panel's own query, so the action refetches it
  // rather than invalidating the route (same contract as SessionsPanel). The
  // Better Auth call unwraps through the shared `unwrapAuthResult`, like every
  // other panel.
  const remove = useAuthClientAction({
    refetch,
    call: (input: { readonly id: string }) =>
      unwrapAuthResult(
        () => authClient.passkey.deletePasskey(input),
        m.passkey_action_failed()
      ),
    failureMessage: m.passkey_action_failed()
  })

  return (
    <>
      <ActionFeedback error={loadError} />
      <ActionFeedback error={remove.error} />

      {hydrated && isPending ? (
        <ul className="grid gap-2" aria-busy="true">
          <li className="rounded-sm border border-border px-3 py-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-1 h-3 w-56" />
          </li>
        </ul>
      ) : null}

      {Array.isArray(rows) && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{m.no_passkeys_description()}</p>
      ) : null}

      {Array.isArray(rows) && rows.length > 0 ? (
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm border border-border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">{row.label}</p>
                <p className="text-xs text-muted-foreground">
                  {row.synced ? m.synced_passkey() : m.device_passkey()} ·{' '}
                  {m.added_label()} {row.createdLabel}
                </p>
              </div>
              <RenamePasskey
                row={row}
                onDone={() => {
                  void refetch()
                }}
              />
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="ghost"
                      aria-label={m.remove_passkey_named({ name: row.label })}
                    />
                  }
                >
                  {m.action_remove()}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>
                    {m.remove_passkey_named({ name: row.label })}?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {m.public_auth_remove_passkey_description()}
                  </AlertDialogDescription>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{m.common_cancel()}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => remove.run({ id: row.id })}>
                      {m.remove_passkey_action()}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      ) : null}

      <AddPasskeyForm
        onDone={() => {
          void refetch()
        }}
      />
    </>
  )
}

/**
 * Registration: a label, then the ceremony. The label is optional in the
 * protocol; the form asks for it anyway because a named passkey is the only
 * kind the list can tell apart.
 */
function AddPasskeyForm({
  onDone
}: {
  /** Signals the panel to refetch its list; the query, not local state, owns it. */
  readonly onDone: () => void
}) {
  const [name, setName] = useState('')
  const add = useServerAction(
    () => {
      const trimmed = name.trim()
      return unwrapAuthResult(
        () =>
          authClient.passkey.addPasskey(trimmed.length > 0 ? { name: trimmed } : {}),
        m.passkey_add_failed()
      )
    },
    {
      failureMessage: m.passkey_add_failed(),
      invalidate: false,
      onSuccess: () => {
        setName('')
        onDone()
      }
    }
  )

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        add.run()
      }}
      className="grid gap-3 border-t border-border pt-4"
    >
      <div className="grid gap-1.5">
        <Label htmlFor="passkey-name">{m.form_passkey_name()}</Label>
        <Input
          id="passkey-name"
          placeholder="MacBook Touch ID"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" className="w-fit" disabled={add.pending}>
        {m.add_passkey()}
      </Button>
      <p className="text-xs text-muted-foreground">{m.passkey_browser_prompt()}</p>
      <ActionFeedback error={add.error} />
    </form>
  )
}

/**
 * The rename affordance: the row's label until armed, then its own small form
 * (input plus save/cancel). The name is presentation only — renaming never
 * touches the credential itself.
 */
function RenamePasskey({
  row,
  onDone
}: {
  readonly row: PasskeyRowView
  /** Signals the panel to refetch its list; the query, not local state, owns it. */
  readonly onDone: () => void
}) {
  const [armed, setArmed] = useState(false)
  const [name, setName] = useState(row.label)
  const rename = useServerAction(
    () =>
      unwrapAuthResult(
        () => authClient.passkey.updatePasskey({ id: row.id, name: name.trim() }),
        m.passkey_action_failed()
      ),
    {
      failureMessage: m.passkey_action_failed(),
      invalidate: false,
      onSuccess: () => {
        setArmed(false)
        onDone()
      }
    }
  )

  if (!armed) {
    return (
      <Button
        variant="ghost"
        aria-label={m.rename_passkey_named({ name: row.label })}
        onClick={() => setArmed(true)}
      >
        {m.rename_action()}
      </Button>
    )
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        rename.run()
      }}
      className="flex items-center gap-2"
      aria-label={m.rename_passkey_named({ name: row.label })}
    >
      <Label htmlFor={`passkey-rename-${row.id}`} className="sr-only">
        {m.new_name()}
      </Label>
      <Input
        id={`passkey-rename-${row.id}`}
        value={name}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
        required
        className="h-8 w-36"
      />
      <Button type="submit" variant="outline" disabled={rename.pending}>
        {m.save_action()}
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          setName(row.label)
          setArmed(false)
        }}
      >
        {m.common_cancel()}
      </Button>
      <ActionFeedback error={rename.error} />
    </form>
  )
}
