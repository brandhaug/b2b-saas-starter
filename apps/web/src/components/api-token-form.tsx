import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { Cause, Effect, Exit, Option } from 'effect'
import {
  API_TOKEN_SCOPES,
  type ApiTokenScope,
  type CreatedApiToken
} from '@b2b-saas-starter/capabilities'
import { FormTextField } from '@/components/form-text-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { createApiTokenServerFn } from '@/lib/server/api-tokens'

const CREATE_TOKEN_FAILED = 'Failed to create token'

type ApiTokenValues = {
  name: string
  scopes: readonly ApiTokenScope[]
}

function validateTokenName(value: string): string | undefined {
  if (value.trim().length === 0) return 'Token name is required'
  if (value.length > 80) return 'Token name must be under 80 characters'
  return
}

export function ApiTokenForm({
  workspaceSlug,
  onCreated
}: {
  readonly workspaceSlug: string
  readonly onCreated?: (token: CreatedApiToken) => void
}) {
  const [created, setCreated] = useState<CreatedApiToken | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: {
      name: '',
      scopes: ['read'] as readonly ApiTokenScope[]
    } satisfies ApiTokenValues,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      // The server function rejects when the capability fails. `Effect.tryPromise`
      // moves that rejection into the error channel as a display message, so the
      // failure path is a value instead of a try/catch.
      const exit = await Effect.runPromiseExit(
        Effect.tryPromise({
          try: () =>
            createApiTokenServerFn({
              data: {
                workspaceSlug,
                name: value.name,
                scopes: value.scopes
              }
            }),
          catch: (cause) =>
            cause instanceof Error ? cause.message : CREATE_TOKEN_FAILED
        })
      )

      if (Exit.isFailure(exit)) {
        setSubmitError(
          Option.getOrElse(Cause.findErrorOption(exit.cause), () => CREATE_TOKEN_FAILED)
        )
        return
      }
      setCreated(exit.value)
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
        validators={{ onChange: ({ value }) => validateTokenName(value) }}
      >
        {(field) => (
          <FormTextField
            name={field.name}
            label="Token name"
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            placeholder="MCP local client"
          />
        )}
      </form.Field>

      <form.Field
        name="scopes"
        validators={{
          onChange: ({ value }) =>
            value.length === 0 ? 'Pick at least one scope' : undefined
        }}
      >
        {(field) => {
          const hasError = field.state.meta.errors.length > 0
          const errorId = `${field.name}-error`
          return (
            <fieldset
              className="grid gap-2"
              aria-invalid={hasError}
              aria-describedby={hasError ? errorId : undefined}
            >
              <legend className="text-sm font-medium leading-none">Scopes</legend>
              <div className="flex flex-wrap gap-3">
                {API_TOKEN_SCOPES.map((scope) => {
                  const checked = field.state.value.includes(scope)
                  return (
                    <label key={scope} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => {
                          const isChecked = next
                          field.handleChange(
                            isChecked
                              ? [...new Set([...field.state.value, scope])]
                              : field.state.value.filter((item) => item !== scope)
                          )
                        }}
                      />
                      <span>{scope}</span>
                    </label>
                  )
                })}
              </div>
              {hasError ? (
                <p id={errorId} className="text-xs text-destructive">
                  {field.state.meta.errors.join(', ')}
                </p>
              ) : null}
            </fieldset>
          )
        }}
      </form.Field>

      <form.Subscribe
        selector={(state) => [state.canSubmit, state.isSubmitting] as const}
      >
        {([canSubmit, isSubmitting]) => (
          <Button type="submit" disabled={!canSubmit} className="justify-self-start">
            {isSubmitting ? 'Creating…' : 'Create token'}
          </Button>
        )}
      </form.Subscribe>

      {created ? (
        <div className="grid gap-1 rounded-md border border-border bg-muted/40 p-3 text-xs">
          <p className="font-medium">
            Token created — copy it now, it will not be shown again.
          </p>
          <code className="break-all">{created.token}</code>
        </div>
      ) : null}
      {submitError ? (
        <p className="text-xs text-destructive" role="alert">
          {submitError}
        </p>
      ) : null}
    </form>
  )
}
