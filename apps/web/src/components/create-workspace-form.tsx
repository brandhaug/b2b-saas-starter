import { type CreatedWorkspace } from '@b2b-saas-starter/capabilities/src/governance/workspace-lifecycle.ts'
import { useRef, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { Cause, Effect, Exit, Option } from 'effect'
import { FormTextField } from '@/components/form-text-field'
import { Button } from '@/components/ui/button'
import { causeMessage } from '@/lib/cause-message'
import { createWorkspaceServerFn } from '@/lib/server/workspace-lifecycle'

const CREATE_WORKSPACE_FAILED = 'Failed to create workspace'

type WorkspaceValues = {
  name: string
  slug: string
}

const DEFAULT_VALUES: WorkspaceValues = { name: '', slug: '' }

/** Turns a workspace name into a slug suggestion: "Acme Corp" → "acme-corp". */
function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40)
    .replaceAll(/-+$/g, '')
}

function validateName(value: string): string | undefined {
  if (value.trim().length === 0) return 'Workspace name is required'
  if (value.length > 80) return 'Workspace name must be under 80 characters'
  return
}

function validateSlug(value: string): string | undefined {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(value)) {
    return 'Use lowercase letters, digits, and hyphens; start and end with a letter or digit'
  }
  return
}

/**
 * The one server call this form makes, as a port — injected so a test drives
 * the form without a server function. The default is the production server fn.
 */
export type CreateWorkspace = (input: {
  readonly data: {
    readonly name: string
    readonly slug: string
    readonly userId: string
  }
}) => Promise<CreatedWorkspace>

export function CreateWorkspaceForm({
  userId,
  onCreated,
  createWorkspace = createWorkspaceServerFn
}: {
  readonly userId: string
  readonly onCreated?: (workspace: CreatedWorkspace) => void
  readonly createWorkspace?: CreateWorkspace
}) {
  const [submitError, setSubmitError] = useState<string | null>(null)
  // The slug mirrors the name until the visitor edits it — then their choice
  // wins and the name stops suggesting. A ref, not state: nothing renders from
  // this, so re-drawing the form for it would be waste.
  const slugEdited = useRef(false)
  const form = useForm({
    defaultValues: DEFAULT_VALUES,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      const exit = await Effect.runPromiseExit(
        Effect.tryPromise({
          try: () =>
            createWorkspace({
              data: { name: value.name, slug: value.slug, userId }
            }),
          catch: (cause) => causeMessage(cause, CREATE_WORKSPACE_FAILED)
        })
      )
      if (Exit.isFailure(exit)) {
        setSubmitError(
          Option.getOrElse(
            Cause.findErrorOption(exit.cause),
            () => CREATE_WORKSPACE_FAILED
          )
        )
        return
      }
      onCreated?.(exit.value)
      form.reset()
    }
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
      className="grid gap-4"
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
            onChange={(next) => {
              field.handleChange(next)
              if (!slugEdited.current) form.setFieldValue('slug', suggestSlug(next))
            }}
            placeholder="Acme Corp"
          />
        )}
      </form.Field>
      <form.Field
        name="slug"
        validators={{ onChange: ({ value }) => validateSlug(value) }}
      >
        {(field) => (
          <FormTextField
            name={field.name}
            label="Workspace URL"
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={(next) => {
              slugEdited.current = true
              field.handleChange(next)
            }}
            placeholder="acme-corp"
          />
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
            {isSubmitting ? 'Creating…' : 'Create workspace'}
          </Button>
        )}
      </form.Subscribe>
      {submitError ? (
        <p className="text-xs text-destructive" role="alert">
          {submitError}
        </p>
      ) : null}
    </form>
  )
}
