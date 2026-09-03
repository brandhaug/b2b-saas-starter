import { useQuery } from '@tanstack/react-query'
import { FingerprintIcon } from 'lucide-react'
import { useState } from 'react'
import {
  addPasskeyWithAuthClient,
  deletePasskeyWithAuthClient,
  listPasskeysWithAuthClient,
  updatePasskeyWithAuthClient,
  type AddPasskey,
  type DeletePasskey,
  type ListPasskeys,
  type PasskeyRecord,
  type UpdatePasskeyName
} from '@/components/auth/auth-client-ports'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useServerAction } from '@/hooks/use-server-action'
import { authFailure } from '@/lib/auth-result'
import { useHydrated } from '@/lib/client-only-value'
import { formatUtc } from '@/lib/format-date'

export type {
  AddPasskey,
  DeletePasskey,
  ListPasskeys,
  PasskeyRecord,
  UpdatePasskeyName
} from '@/components/auth/auth-client-ports'

const PASSKEYS_QUERY_KEY: ReadonlyArray<unknown> = ['account', 'passkeys']
const ACTION_FAILED = 'The change could not be made'
const ADD_FAILED = 'Could not add the passkey'

/** One row of the panel's own view model — dates formatted client-side only. */
export type PasskeyRowView = {
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
  return 'Passkey'
}

function toViewModels(passkeys: ReadonlyArray<PasskeyRecord>): Array<PasskeyRowView> {
  return passkeys
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((passkey) => ({
      id: passkey.id,
      label: describeLabel(passkey),
      synced: passkey.backedUp,
      createdLabel: formatUtc(passkey.createdAt, { dateStyle: 'medium' })
    }))
}

/**
 * Passkey management for the signed-in user: register (with a user-chosen
 * name), rename, and remove. Registering runs a WebAuthn ceremony the browser
 * mediates — the panel's own state covers only the label and the list around
 * it. Like `SessionsPanel`, the list is this panel's own query (not a
 * loader's), so actions refetch it instead of invalidating the route.
 */
export function PasskeysPanel({
  listPasskeys = listPasskeysWithAuthClient,
  addPasskey = addPasskeyWithAuthClient,
  updatePasskey = updatePasskeyWithAuthClient,
  deletePasskey = deletePasskeyWithAuthClient
}: {
  readonly listPasskeys?: ListPasskeys
  readonly addPasskey?: AddPasskey
  readonly updatePasskey?: UpdatePasskeyName
  readonly deletePasskey?: DeletePasskey
}) {
  const hydrated = useHydrated()
  const {
    data: rows,
    error: queryError,
    isPending,
    refetch
  } = useQuery({
    queryKey: PASSKEYS_QUERY_KEY,
    queryFn: async (): Promise<ReadonlyArray<PasskeyRowView>> => {
      const result = await listPasskeys()
      if (result.error) {
        // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- TanStack Query surfaces failure states by rejecting the query function; there is no Effect channel here
        throw new Error(result.error.message ?? 'Could not load passkeys')
      }
      return toViewModels(result.data ?? [])
    },
    enabled: hydrated,
    retry: false
  })
  const loadError = queryError?.message ?? null
  // The passkey list is this panel's own query, so the action refetches it
  // rather than invalidating the route (same contract as SessionsPanel).
  const remove = useServerAction(
    async (input: { readonly id: string }) => {
      const result = await deletePasskey(input)
      if (result.error) {
        return authFailure(result.error.message ?? ACTION_FAILED)
      }
    },
    {
      failureMessage: ACTION_FAILED,
      invalidate: false,
      onSuccess: () => {
        void refetch()
      }
    }
  )

  return (
    <section className="grid gap-4" aria-label="Passkeys">
      <header className="flex items-center gap-2">
        <FingerprintIcon className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Passkeys</h3>
      </header>

      {loadError ? (
        <p role="alert" className="text-xs text-destructive">
          {loadError}
        </p>
      ) : null}
      {remove.error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {remove.error}
        </p>
      )}

      {hydrated && isPending ? (
        <ul className="grid gap-2" aria-busy="true">
          {[0].map((index) => (
            <li key={index} className="rounded-sm border border-border px-3 py-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-1 h-3 w-56" />
            </li>
          ))}
        </ul>
      ) : null}

      {Array.isArray(rows) && rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No passkeys yet. Add one to sign in with a fingerprint, face, or security key
          instead of a password.
        </p>
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
                  {row.synced ? 'Synced passkey' : 'Device passkey'} · Added{' '}
                  {row.createdLabel}
                </p>
              </div>
              <RenamePasskey
                row={row}
                updatePasskey={updatePasskey}
                onDone={() => {
                  void refetch()
                }}
              />
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${row.label} passkey`}
                    />
                  }
                >
                  Remove
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>Remove the {row.label} passkey?</AlertDialogTitle>
                  <AlertDialogDescription>
                    That passkey will no longer be able to sign in. If it is the only
                    one, you will need your password (and two-factor code, if enabled).
                  </AlertDialogDescription>
                  <div className="flex justify-end gap-2">
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => remove.run({ id: row.id })}>
                      Remove passkey
                    </AlertDialogAction>
                  </div>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      ) : null}

      <AddPasskeyForm
        addPasskey={addPasskey}
        onDone={() => {
          void refetch()
        }}
      />
    </section>
  )
}

/**
 * Registration: a label, then the ceremony. The label is optional in the
 * protocol; the form asks for it anyway because a named passkey is the only
 * kind the list can tell apart.
 */
function AddPasskeyForm({
  addPasskey,
  onDone
}: {
  readonly addPasskey: AddPasskey
  /** Signals the panel to refetch its list; the query, not local state, owns it. */
  readonly onDone: () => void
}) {
  const [name, setName] = useState('')
  const add = useServerAction(
    async () => {
      const trimmed = name.trim()
      const result = await addPasskey(trimmed.length > 0 ? { name: trimmed } : {})
      if (result.error) {
        return authFailure(result.error.message ?? ADD_FAILED)
      }
    },
    {
      failureMessage: ADD_FAILED,
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
        <Label htmlFor="passkey-name">Name a new passkey</Label>
        <Input
          id="passkey-name"
          placeholder="MacBook Touch ID"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" className="w-fit" disabled={add.pending}>
        Add passkey
      </Button>
      <p className="text-xs text-muted-foreground">
        Your browser will ask you to create the credential with a fingerprint, face,
        PIN, or security key.
      </p>
      <SubmitError message={add.error} />
    </form>
  )
}

/** A failed action's message, in the panel's error voice. */
function SubmitError({ message }: { readonly message: string | null }) {
  return message === null ? null : (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}

/**
 * The rename affordance: the row's label until armed, then its own small form
 * (input plus save/cancel). The name is presentation only — renaming never
 * touches the credential itself.
 */
function RenamePasskey({
  row,
  updatePasskey,
  onDone
}: {
  readonly row: PasskeyRowView
  readonly updatePasskey: UpdatePasskeyName
  /** Signals the panel to refetch its list; the query, not local state, owns it. */
  readonly onDone: () => void
}) {
  const [armed, setArmed] = useState(false)
  const [name, setName] = useState(row.label)
  const rename = useServerAction(
    async () => {
      const result = await updatePasskey({ id: row.id, name: name.trim() })
      if (result.error) {
        return authFailure(result.error.message ?? ACTION_FAILED)
      }
    },
    {
      failureMessage: ACTION_FAILED,
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
        size="sm"
        aria-label={`Rename ${row.label} passkey`}
        onClick={() => setArmed(true)}
      >
        Rename
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
      aria-label={`Rename ${row.label} passkey`}
    >
      <Label htmlFor={`passkey-rename-${row.id}`} className="sr-only">
        New name
      </Label>
      <Input
        id={`passkey-rename-${row.id}`}
        value={name}
        autoComplete="off"
        onChange={(event) => setName(event.target.value)}
        required
        className="h-8 w-36"
      />
      <Button type="submit" variant="outline" size="sm" disabled={rename.pending}>
        Save
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          setName(row.label)
          setArmed(false)
        }}
      >
        Cancel
      </Button>
      <SubmitError message={rename.error} />
    </form>
  )
}
