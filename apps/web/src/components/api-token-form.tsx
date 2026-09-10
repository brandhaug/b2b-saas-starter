import {
  type ApiTokenScope,
  type CreatedApiToken
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { apiTokenScopes } from '@/lib/permissions'
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'

import { CheckboxSetField } from '@/components/checkbox-set-field'
import { FormTextField } from '@/components/form-text-field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { FormSubmitButton } from '@/components/form-submit-button'
import { SecretReveal } from '@/components/secret-reveal'
import { createApiTokenServerFn } from '@/lib/server/api-tokens'
import { useServerCall } from '@/hooks/use-server-call'
import { m } from '@b2b-saas-starter/i18n/messages'

type ApiTokenValues = {
  name: string
  scopes: ReadonlyArray<ApiTokenScope>
  expiry: string
}

const DEFAULT_TOKEN_VALUES: ApiTokenValues = {
  name: '',
  scopes: ['read'],
  expiry: ''
}

function validateTokenName(value: string): string | undefined {
  if (value.trim().length === 0) {
    return m.token_name_required()
  }
  if (value.length > 100) {
    return m.token_name_maximum()
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
    readonly expiresAt?: string
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
  const callServerFn = useServerCall()
  const [created, setCreated] = useState<CreatedApiToken | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: DEFAULT_TOKEN_VALUES,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      // The server function rejects when the capability fails. `callServerFn`
      // moves that rejection into the error channel as a display message, so
      // the failure path is a value instead of a try/catch.
      const data: Parameters<CreateApiToken>[0]['data'] = {
        workspaceSlug,
        name: value.name,
        scopes: value.scopes
      }
      const request = value.expiry
        ? { ...data, expiresAt: new Date(`${value.expiry}Z`).toISOString() }
        : data
      const outcome = await callServerFn(
        () => createToken({ data: request }),
        m.api_token_create_failed()
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
            label={m.form_token_name()}
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            placeholder={m.form_token_placeholder()}
          />
        )}
      </form.Field>

      <form.Field
        name="scopes"
        validators={{
          onChange: ({ value }) => (value.length === 0 ? m.scope_required() : undefined)
        }}
      >
        {(field) => (
          <CheckboxSetField
            name={field.name}
            legend={m.scopes()}
            options={apiTokenScopes}
            value={field.state.value}
            errors={field.state.meta.errors}
            onChange={field.handleChange}
          />
        )}
      </form.Field>

      <form.Field
        name="expiry"
        validators={{
          onChange: ({ value }) =>
            value && !(Date.parse(`${value}Z`) > Date.now())
              ? m.expiry_future_required()
              : undefined
        }}
      >
        {(field) => (
          <FormTextField
            name="create-token-expiry"
            label={m.form_expiry()}
            type="datetime-local"
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
          />
        )}
      </form.Field>
      <p className="text-xs text-muted-foreground">{m.form_expiry_hint()}</p>

      <FormSubmitButton form={form} label={m.form_create_token()} />

      {created ? (
        // The one secret this form ever shows: the `ok` variant separates it
        // from every neutral box on the page, and the title carries the copy
        // guidance — this is the only chance to take the token.
        <Alert variant="ok" className="justify-self-start">
          <AlertTitle>{m.token_created_copy_now()}</AlertTitle>
          <AlertDescription>
            <SecretReveal
              secret={created.token}
              label={m.form_api_token()}
              className="flex items-center gap-2"
            />
            <p className="mt-2 text-xs">{m.token_store_secret()}</p>
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
