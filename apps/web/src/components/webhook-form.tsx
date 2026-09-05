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
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { createWebhookEndpointServerFn } from '@/lib/server/webhooks'
import { callServerFn } from '@/lib/server-call'

const CREATE_WEBHOOK_FAILED = 'Failed to create webhook endpoint'

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
    return 'Endpoint URL is required'
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
  readonly onCreated?: (created: CreatedWebhookEndpoint) => void
  readonly createEndpoint?: CreateWebhookEndpoint
}) {
  const [created, setCreated] = useState<CreatedWebhookEndpoint | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
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
        CREATE_WEBHOOK_FAILED
      )

      if (!outcome.ok) {
        setSubmitError(outcome.message)
        return
      }
      // No toast: the inline ok alert below carries the created endpoint
      // and its signing secret — the corner copy would say less.
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
        name="url"
        validators={{ onChange: ({ value }) => validateUrl(value) }}
      >
        {(field) => (
          <FormTextField
            name={field.name}
            label="Endpoint URL"
            value={field.state.value}
            errors={field.state.meta.errors}
            onBlur={field.handleBlur}
            onChange={field.handleChange}
            placeholder="https://example.com/hooks/b2b-starter"
          />
        )}
      </form.Field>

      <form.Field
        name="events"
        validators={{
          onChange: ({ value }) =>
            value.length === 0 ? 'Pick at least one event' : undefined
        }}
      >
        {(field) => (
          <CheckboxSetField
            name={field.name}
            legend="Events"
            options={WEBHOOK_EVENT_TYPES}
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
            Create endpoint
          </Button>
        )}
      </form.Subscribe>

      {created ? (
        // `ok`, not the neutral default: this is the one moment the signing
        // secret is visible, the same treatment the API token form's reveal
        // and the rotated-secret alert get.
        <Alert variant="ok" className="justify-self-start">
          <AlertTitle>
            Endpoint created. Copy the signing secret now, it will not be shown again.
          </AlertTitle>
          <AlertDescription>
            <Identifier className="px-2 py-1">{created.signingSecret}</Identifier>
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
