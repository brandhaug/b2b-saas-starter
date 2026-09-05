import {
  API_TOKEN_SCOPES,
  type ApiTokenScope,
  type CreatedApiToken
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'

import { CheckboxSetField } from '@/components/checkbox-set-field'
import { FormTextField } from '@/components/form-text-field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { SecretReveal } from '@/components/secret-reveal'
import { createApiTokenServerFn } from '@/lib/server/api-tokens'
import { callServerFn } from '@/lib/server-call'

const CREATE_TOKEN_FAILED = 'Failed to create token'

type ApiTokenValues = {
  name: string
  scopes: ReadonlyArray<ApiTokenScope>
}

const DEFAULT_TOKEN_VALUES: ApiTokenValues = {
  name: '',
  scopes: ['read']
}

function validateTokenName(value: string): string | undefined {
  if (value.trim().length === 0) {
    return 'Token name is required'
  }
  if (value.length > 80) {
    return 'Token name must be under 80 characters'
  }
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
    readonly scopes: ReadonlyArray<ApiTokenScope>
  }
}) => Promise<CreatedApiToken>

/** What the form reports after a create; awaited by the submit flow. */
export type OnApiTokenCreated = (token: CreatedApiToken) => void | Promise<void>

export function ApiTokenForm({
  workspaceSlug,
  onCreated,
  createToken = createApiTokenServerFn
}: {
  readonly workspaceSlug: string
  readonly onCreated?: OnApiTokenCreated
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
      // No toast: the inline ok alert reveals the token's one-time secret —
      // a corner copy would announce the creation without the thing the
      // reader actually needs to copy.
      setCreated(outcome.value)
      // Awaited so the loader invalidation completes within the submit flow:
      // fire-and-forget here is how the list stayed a create behind until a
      // reload.
      await onCreated?.(outcome.value)
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
        {(field) => (
          <CheckboxSetField
            name={field.name}
            legend="Scopes"
            options={API_TOKEN_SCOPES}
            value={field.state.value}
            errors={field.state.meta.errors}
            onChange={field.handleChange}
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
        // The one secret this form ever shows: the `ok` variant separates it
        // from every neutral box on the page, and the title carries the copy
        // guidance — this is the only chance to take the token.
        <Alert variant="ok" className="justify-self-start">
          <AlertTitle>
            Token created. Copy it now, it will not be shown again.
          </AlertTitle>
          <AlertDescription>
            <SecretReveal
              secret={created.token}
              label="API token"
              className="flex items-center gap-2"
            />
            <p className="mt-2 text-xs">
              Store it in your secret manager before leaving this page.
            </p>
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
