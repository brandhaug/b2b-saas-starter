import { WEBHOOK_EVENT_TYPES } from '@b2b-saas-starter/capabilities/developer-platform/webhook-events'
import {
  type CreatedWebhookEndpoint,
  type WebhookEventType
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'

import { CheckboxSetField } from '@/components/checkbox-set-field'
import { FormTextField } from '@/components/form-text-field'
import { Identifier } from '@/components/page/identifier'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { FormSubmitButton } from '@/components/form-submit-button'
import { createWebhookEndpointServerFn } from '@/lib/server/webhooks'
import { useServerCall } from '@/hooks/use-server-call'
import { useServerAction } from '@/hooks/use-server-action'
import { Button } from '@/components/ui/button'
import { m } from '@b2b-saas-starter/i18n/messages'

type WebhookValues = {
  url: string
  events: ReadonlyArray<WebhookEventType>
}

const DEFAULT_VALUES: WebhookValues = {
  url: '',
  events: ['api_token.created']
}

function validateUrl(value: string): string | undefined {
  if (value.trim().length === 0) {
    return m.endpoint_url_required()
  }
  return
}

/**
 * The one server call this form makes, as a port. Injected rather than imported
 * at the call site so a test drives the form with a real function of this shape
 * instead of replacing the module it lives in. The default is the production
 * server function, so every caller but a test passes nothing.
 */
export type CreateWebhookEndpoint = (input: {
  readonly data: {
    readonly workspaceSlug: string
    readonly url: string
    readonly events: ReadonlyArray<string>
  }
}) => Promise<CreatedWebhookEndpoint>

export function WebhookForm({
  workspaceSlug,
  onCreated,
  createEndpoint = createWebhookEndpointServerFn
}: {
  readonly workspaceSlug: string
  readonly onCreated?: (created: CreatedWebhookEndpoint) => void | Promise<void>
  readonly createEndpoint?: CreateWebhookEndpoint
}) {
  const callServerFn = useServerCall()
  const [created, setCreated] = useState<{
    readonly value: CreatedWebhookEndpoint
    readonly refresh: 'needed' | 'complete'
  } | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const refreshAction = useServerAction(
    async (value: CreatedWebhookEndpoint) => onCreated?.(value),
    {
      failureMessage: m.shell_error(),
      invalidate: false,
      identityKey: workspaceSlug
    }
  )
  const form = useForm({
    defaultValues: DEFAULT_VALUES,
    onSubmit: async ({ value }) => {
      setSubmitError(null)
      // The server function rejects when the capability or the SSRF guard
      // fails. `callServerFn` moves that rejection into the error channel
      // as a display message, so the failure path is a value not a try/catch.
      const outcome = await callServerFn(
        () =>
          createEndpoint({
            data: {
              workspaceSlug,
              url: value.url,
              events: value.events
            }
          }),
        m.webhook_create_failed()
      )

      if (!outcome.ok) {
        setSubmitError(outcome.message)
        return
      }
      // No toast: the inline ok alert below carries the created endpoint
      // and its signing secret — the corner copy would say less.
      setCreated({ value: outcome.value, refresh: 'needed' })
      await refresh(outcome.value)
    }
  })

  async function refresh(value: CreatedWebhookEndpoint) {
    const outcome = await refreshAction.runAsync(value)
    setCreated({ value, refresh: outcome.ok ? 'complete' : 'needed' })
    setSubmitError(outcome.ok ? null : outcome.message)
    if (outcome.ok) {
      form.reset()
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (form.state.isSubmitting || refreshAction.pending) {
          return
        }
        if (created?.refresh === 'needed') {
          void refresh(created.value)
        } else {
          void form.handleSubmit()
        }
      }}
      className="grid gap-4"
    >
      <form.Field
        name="url"
        validators={{ onChange: ({ value }) => validateUrl(value) }}
      >
        {(field) => (
          <FormTextField
            name={field.name}
            label={m.endpoint_url()}
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            placeholder={m.endpoint_url_placeholder()}
          />
        )}
      </form.Field>

      <form.Field
        name="events"
        validators={{
          onChange: ({ value }) =>
            value.length === 0 ? m.webhook_event_required() : undefined
        }}
      >
        {(field) => (
          <CheckboxSetField
            name={field.name}
            legend={m.events()}
            options={WEBHOOK_EVENT_TYPES}
            value={field.state.value}
            errors={field.state.meta.errors}
            onChange={field.handleChange}
          />
        )}
      </form.Field>

      {created?.refresh === 'needed' ? (
        <Button
          type="button"
          disabled={refreshAction.pending}
          onClick={() => void refresh(created.value)}
        >
          {m.retry_action()}
        </Button>
      ) : (
        <FormSubmitButton form={form} label={m.webhook_create_action()} />
      )}

      {created ? (
        // `ok`, not the neutral default: this is the one moment the signing
        // secret is visible, the same treatment the API token form's reveal
        // and the rotated-secret alert get.
        <Alert variant="ok" className="justify-self-start">
          <AlertTitle>{m.webhook_created_copy_notice()}</AlertTitle>
          <AlertDescription>
            <Identifier className="px-2 py-1">{created.value.signingSecret}</Identifier>
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
