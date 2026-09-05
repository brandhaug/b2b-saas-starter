import { useRef, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { FormTextField } from '@/components/form-text-field'
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
import {
  deleteWorkspaceServerFn,
  renameWorkspaceServerFn
} from '@/lib/server/workspace-lifecycle'
import { useServerAction } from '@/hooks/use-server-action'
import { ActionFeedback } from '@/components/page/action-feedback'
import { validateWorkspaceName } from '@/lib/workspace-name'

const RENAME_FAILED = 'Failed to rename workspace'
const DELETE_FAILED = 'Failed to delete workspace'

/** The rename call, as a port — same shape as `CreateApiToken`. */
export type RenameWorkspace = (input: {
  readonly data: { readonly workspaceSlug: string; readonly name: string }
}) => Promise<{ readonly name: string }>

export type DeleteWorkspace = (input: {
  readonly data: { readonly workspaceSlug: string }
}) => Promise<void>

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
  const submit = useServerAction(
    (name: string) => rename({ data: { workspaceSlug, name } }),
    {
      failureMessage: RENAME_FAILED,
      invalidate: false,
      onSuccess: (_, name) => {
        toast.success(`Workspace renamed to “${name}”`)
      }
    }
  )
  const form = useForm({
    defaultValues: { name: currentName },
    onSubmit: async ({ value }) => {
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
        validators={{ onChange: ({ value }) => validateWorkspaceName(value) }}
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
      <ActionFeedback error={submit.error} />
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
  const [open, setOpen] = useState(false)
  // The typed-name gate: confirm unlocks only when this matches the slug.
  const [typed, setTyped] = useState('')
  const cancelRef = useRef<HTMLButtonElement | null>(null)

  // No loader to re-run: the workspace is gone and its routes no longer
  // resolve, so a former owner lands on the workspaces list instead.
  const confirmDelete = useServerAction(() => remove({ data: { workspaceSlug } }), {
    failureMessage: DELETE_FAILED,
    invalidate: false,
    onSuccess: () => window.location.assign('/workspaces')
  })

  const armed = typed.trim() === workspaceSlug

  return (
    <div className="grid gap-2 rounded-none bg-muted p-4">
      <p className="text-sm font-medium">Delete this workspace</p>
      <p className="text-sm text-muted-foreground">
        Removing <span className="font-medium">{name}</span> removes every member,
        invitation, API token, and webhook with it. This cannot be undone.
      </p>
      <AlertDialog
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (!nextOpen) {
            setTyped('')
          }
        }}
      >
        <AlertDialogTrigger
          render={<Button variant="destructive" className="justify-self-start" />}
        >
          Delete workspace
        </AlertDialogTrigger>
        {/* Focus starts on Cancel, not the text field: the default action for
            a dialog this destructive must be to leave it. */}
        <AlertDialogContent initialFocus={cancelRef}>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes every member, invitation, API token, and webhook with it, and
            cannot be undone. Type the workspace slug to confirm.
          </AlertDialogDescription>
          <div className="grid gap-1.5">
            <Label htmlFor="delete-workspace-confirm">
              Type <span className="font-mono">{workspaceSlug}</span> to confirm
            </Label>
            <Input
              id="delete-workspace-confirm"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full"
            />
          </div>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel ref={cancelRef}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!armed}
              onClick={() => confirmDelete.run()}
            >
              Delete this workspace permanently
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
      {/* The dialog is gone by the time a failure lands, so it renders here,
          under the section that owns the action. */}
      <ActionFeedback error={confirmDelete.error} />
    </div>
  )
}
