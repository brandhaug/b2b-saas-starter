import {
  API_TOKEN_SCOPES,
  type ApiTokenScope,
  type CreatedApiToken
} from '@b2b-saas-starter/capabilities/src/developer-platform/api-token-registry.ts'
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'

import { FormTextField } from '@/components/form-text-field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { createApiTokenServerFn } from '@/lib/server/api-tokens'
import { callServerFn } from '@/lib/server-call'

const CREATE_TOKEN_FAILED = 'Failed to create token'

type ApiTokenValues = {
  name: string
  scopes: readonly ApiTokenScope[]
}

const DEFAULT_TOKEN_VALUES: ApiTokenValues = {
  name: '',
  scopes: ['read']
}

function validateTokenName(value: string): string | undefined {
  if (value.trim().length === 0) return 'Token name is required'
  if (value.length > 80) return 'Token name must be under 80 characters'
  return
}

/**
 * The one server call this form makes, as a port. Injected rather than imported
 * at the call site so a test drives the form with a real function of this shape
 * instead of replacing the module it lives in. The default is the production
 * server function, so every caller but a test passes nothing.
 */
export type CreateApiToken = (input: {
  readonly data: {
    readonly workspaceSlug: string
    readonly name: string
    readonly scopes: readonly ApiTokenScope[]
  }
}) => Promise<CreatedApiToken>

export function ApiTokenForm({
  workspaceSlug,
  onCreated,
  createToken = createApiTokenServerFn
}: {
  readonly workspaceSlug: string
  readonly onCreated?: (token: CreatedApiToken) => void
  readonly createToken?: CreateApiToken
}) {
  const [created, setCreated] = useState<CreatedApiToken | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: DEFAULT_TOKEN_VALUES,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      // The server function rejects when the capability fails. `callServerFn`
      // moves that rejection into the error channel as a display message, so
      // the failure path is a value instead of a try/catch.
      const outcome = await callServerFn(
        () =>
          createToken({
            data: {
              workspaceSlug,
              name: value.name,
              scopes: value.scopes
            }
          }),
        CREATE_TOKEN_FAILED
      )

      if (!outcome.ok) {
        setSubmitError(outcome.message)
        return
      }
      setCreated(outcome.value)
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
            <FieldSet data-invalid={hasError || undefined}>
              <FieldLegend variant="label">Scopes</FieldLegend>
              <div className="flex flex-wrap gap-3">
                {API_TOKEN_SCOPES.map((scope) => {
                  const checked = field.state.value.includes(scope)
                  return (
                    <FieldLabel key={scope}>
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
                    </FieldLabel>
                  )
                })}
              </div>
              {hasError ? (
                <FieldError id={errorId}>
                  {field.state.meta.errors.join(', ')}
                </FieldError>
              ) : null}
            </FieldSet>
          )
        }}
      </form.Field>

      <form.Subscribe
        selector={(state): readonly [boolean, boolean] => [
          state.canSubmit,
          state.isSubmitting
        ]}
      >
        {([canSubmit, isSubmitting]) => (
          <Button
            type="submit"
            disabled={!canSubmit || isSubmitting}
            className="justify-self-start"
          >
            {isSubmitting ? <Spinner data-icon="inline-start" /> : null}
            Create token
          </Button>
        )}
      </form.Subscribe>

      {created ? (
        <Alert className="justify-self-start">
          <AlertTitle>
            Token created. Copy it now, it will not be shown again.
          </AlertTitle>
          <AlertDescription>
            <code className="break-all">{created.token}</code>
          </AlertDescription>
        </Alert>
      ) : null}
      {submitError ? (
        <Alert variant="destructive" className="justify-self-start">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      ) : null}
    </form>
  )
}
