import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { FormTextField } from '@/components/form-text-field'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  deleteWorkspaceServerFn,
  renameWorkspaceServerFn
} from '@/lib/server/workspace-lifecycle'
import { callServerFn } from '@/lib/server-call'
import { ConfirmButton } from '@/components/confirm-button'

const RENAME_FAILED = 'Failed to rename workspace'
const DELETE_FAILED = 'Failed to delete workspace'

/** The rename call, as a port — same shape as `CreateApiToken`. */
export type RenameWorkspace = (input: {
  readonly data: { readonly workspaceSlug: string; readonly name: string }
}) => Promise<{ readonly name: string }>

export type DeleteWorkspace = (input: {
  readonly data: { readonly workspaceSlug: string }
}) => Promise<void>

function validateName(value: string): string | undefined {
  if (value.trim().length === 0) return 'Workspace name is required'
  if (value.length > 80) return 'Workspace name must be under 80 characters'
  return
}

/**
 * Rename and delete for the settings route. Each section is rendered only when
 * the loader-carrying role permits it (`organization:update` /
 * `organization:delete`); the server functions re-check the same permission.
 */
export function WorkspaceGeneralSettings({
  workspaceSlug,
  currentName,
  canRename,
  canDelete,
  ports
}: {
  readonly workspaceSlug: string
  readonly currentName: string
  readonly canRename: boolean
  readonly canDelete: boolean
  readonly ports?: {
    readonly rename?: RenameWorkspace | undefined
    readonly remove?: DeleteWorkspace | undefined
  }
}) {
  const rename = ports?.rename ?? renameWorkspaceServerFn
  const remove = ports?.remove ?? deleteWorkspaceServerFn

  return (
    <div className="grid gap-6">
      {canRename ? (
        <RenameForm
          workspaceSlug={workspaceSlug}
          currentName={currentName}
          rename={rename}
        />
      ) : null}
      {canDelete ? (
        <DeleteSection
          workspaceSlug={workspaceSlug}
          name={currentName}
          remove={remove}
        />
      ) : null}
    </div>
  )
}

function RenameForm({
  workspaceSlug,
  currentName,
  rename
}: {
  readonly workspaceSlug: string
  readonly currentName: string
  readonly rename: RenameWorkspace
}) {
  const [renamed, setRenamed] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { name: currentName },
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      setRenamed(null)
      const outcome = await callServerFn(
        () => rename({ data: { workspaceSlug, name: value.name.trim() } }),
        RENAME_FAILED
      )
      if (!outcome.ok) {
        setSubmitError(outcome.message)
        return
      }
      setRenamed(value.name.trim())
    }
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
      className="grid gap-3"
      aria-label="Rename workspace"
    >
      <form.Field
        name="name"
        validators={{ onChange: ({ value }) => validateName(value) }}
      >
        {(field) => (
          <FormTextField
            name={field.name}
            label="Workspace name"
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <form.Subscribe
        selector={(state): readonly [boolean, string] => [
          state.canSubmit,
          state.values.name
        ]}
      >
        {([canSubmit, name]) => (
          <Button
            type="submit"
            // A no-op save (the current name) does nothing worth a request.
            disabled={!canSubmit || name.trim() === currentName}
            className="justify-self-start"
          >
            Save name
          </Button>
        )}
      </form.Subscribe>
      {renamed === null ? null : (
        <p className="text-xs text-muted-foreground">
          <output>Workspace renamed to “{renamed}”.</output>
        </p>
      )}
      {submitError ? (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  )
}

function DeleteSection({
  workspaceSlug,
  name,
  remove
}: {
  readonly workspaceSlug: string
  readonly name: string
  readonly remove: DeleteWorkspace
}) {
  const [deleting, setDeleting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function confirmDelete() {
    setSubmitError(null)
    setDeleting(true)
    // The reset rides `finally` so every path clears the flag; `callServerFn`
    // never rejects, but the flag must not survive either outcome.
    const outcome = await callServerFn(
      () => remove({ data: { workspaceSlug } }),
      DELETE_FAILED
    ).finally(() => setDeleting(false))
    if (!outcome.ok) {
      setSubmitError(outcome.message)
      return
    }
    // The workspace is gone; its routes no longer resolve. The workspaces list
    // is where a former owner lands.
    window.location.assign('/workspaces')
  }

  return (
    <div className="grid gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm font-medium">Delete this workspace</p>
      <p className="text-sm text-muted-foreground">
        Removing <span className="font-medium">{name}</span> removes every member,
        invitation, API token, and webhook with it. This cannot be undone.
      </p>
      {/* The confirm step names what is about to be removed, so a stray click
          on the destructive button deletes nothing by itself. */}
      <ConfirmButton
        label="Delete workspace"
        confirmLabel={`Delete ${name} permanently`}
        variant="destructive"
        cancelVariant="outline"
        className="justify-self-start"
        busy={deleting}
        onConfirm={() => void confirmDelete()}
      />
      {submitError ? (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
