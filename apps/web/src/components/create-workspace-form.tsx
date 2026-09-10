import { type CreatedWorkspace } from '@b2b-saas-starter/capabilities/governance/workspace-lifecycle'
import { useRef, useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { FormTextField } from '@/components/form-text-field'
import { FormSubmitButton } from '@/components/form-submit-button'
import { createWorkspaceServerFn } from '@/lib/server/workspace-lifecycle'
import { callServerFn } from '@/lib/server-call'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { validateWorkspaceName } from '@/lib/workspace-name'
import { m } from '@b2b-saas-starter/i18n/messages'

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

function validateSlug(value: string): string | undefined {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(value)) {
    return m.workspace_slug_hint()
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
  }
}) => Promise<CreatedWorkspace>

export function CreateWorkspaceForm({
  onCreated,
  createWorkspace = createWorkspaceServerFn
}: {
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
      const outcome = await callServerFn(
        () => createWorkspace({ data: { name: value.name, slug: value.slug } }),
        m.workspace_create_failed()
      )
      if (!outcome.ok) {
        setSubmitError(outcome.message)
        return
      }
      onCreated?.(outcome.value)
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
        validators={{ onChange: ({ value }) => validateWorkspaceName(value) }}
      >
        {(field) => (
          <FormTextField
            name={field.name}
            label={m.form_workspace_name()}
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={(next) => {
              field.handleChange(next)
              if (!slugEdited.current) {
                form.setFieldValue('slug', suggestSlug(next))
              }
            }}
            placeholder={m.workspace_name_placeholder()}
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
            label={m.form_workspace_url()}
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={(next) => {
              slugEdited.current = true
              field.handleChange(next)
            }}
            placeholder={m.workspace_slug_placeholder()}
          />
        )}
      </form.Field>
      <FormSubmitButton form={form} label={m.form_create_workspace()} />
      {submitError ? (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  )
}
