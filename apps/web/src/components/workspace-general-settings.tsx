import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { FormTextField } from '@/components/form-text-field'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  deleteWorkspaceServerFn,
  renameWorkspaceServerFn
} from '@/lib/server/workspace-lifecycle'
import { useServerAction } from '@/hooks/use-server-action'
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
  if (value.trim().length === 0) {
    return 'Workspace name is required'
  }
  if (value.length > 80) {
    return 'Workspace name must be under 80 characters'
  }
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
  const submit = useServerAction(
    (name: string) => rename({ data: { workspaceSlug, name } }),
    {
      failureMessage: RENAME_FAILED,
      invalidate: false,
      onSuccess: (_, name) => setRenamed(name)
    }
  )
  const form = useForm({
    defaultValues: { name: currentName },
    onSubmit: async ({ value }) => {
      setRenamed(null)
      await submit.runAsync(value.name.trim())
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
      {submit.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{submit.error}</AlertDescription>
        </Alert>
      )}
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
  // No loader to re-run: the workspace is gone and its routes no longer
  // resolve, so a former owner lands on the workspaces list instead.
  const confirmDelete = useServerAction(() => remove({ data: { workspaceSlug } }), {
    failureMessage: DELETE_FAILED,
    invalidate: false,
    onSuccess: () => window.location.assign('/workspaces')
  })

  return (
    <div className="grid gap-2 rounded-none bg-muted p-4">
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
        busy={confirmDelete.pending}
        onConfirm={() => confirmDelete.run()}
      />
      {confirmDelete.error === null ? null : (
        <Alert variant="destructive">
          <AlertDescription>{confirmDelete.error}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
