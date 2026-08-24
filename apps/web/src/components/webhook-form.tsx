import {
  WEBHOOK_EVENT_TYPES,
  type CreatedWebhookEndpoint,
  type WebhookEventType
} from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-endpoints.ts'
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { Cause, Effect, Exit, Option } from 'effect'

import { FormTextField } from '@/components/form-text-field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { causeMessage } from '@/lib/cause-message'
import { createWebhookEndpointServerFn } from '@/lib/server/webhooks'

const CREATE_WEBHOOK_FAILED = 'Failed to create webhook endpoint'

type WebhookValues = {
  url: string
  events: readonly WebhookEventType[]
}

const DEFAULT_VALUES: WebhookValues = {
  url: '',
  events: ['api_token.created']
}

function validateUrl(value: string): string | undefined {
  if (value.trim().length === 0) return 'Endpoint URL is required'
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
    readonly events: readonly string[]
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
      // fails. `Effect.tryPromise` moves that rejection into the error channel
      // as a display message, so the failure path is a value not a try/catch.
      const exit = await Effect.runPromiseExit(
        Effect.tryPromise({
          try: () =>
            createEndpoint({
              data: {
                workspaceSlug,
                url: value.url,
                events: value.events
              }
            }),
          catch: (cause) => causeMessage(cause, CREATE_WEBHOOK_FAILED)
        })
      )

      if (Exit.isFailure(exit)) {
        setSubmitError(
          Option.getOrElse(
            Cause.findErrorOption(exit.cause),
            () => CREATE_WEBHOOK_FAILED
          )
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
        {(field) => {
          const hasError = field.state.meta.errors.length > 0
          const errorId = `${field.name}-error`
          return (
            <FieldSet data-invalid={hasError || undefined}>
              <FieldLegend variant="label">Events</FieldLegend>
              <div className="flex flex-wrap gap-3">
                {WEBHOOK_EVENT_TYPES.map((eventType) => {
                  const checked = field.state.value.includes(eventType)
                  return (
                    <FieldLabel key={eventType}>
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) => {
                          const isChecked = next
                          field.handleChange(
                            isChecked
                              ? [...new Set([...field.state.value, eventType])]
                              : field.state.value.filter((item) => item !== eventType)
                          )
                        }}
                      />

                      <span>{eventType}</span>
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
            Create endpoint
          </Button>
        )}
      </form.Subscribe>

      {created ? (
        <Alert className="justify-self-start">
          <AlertTitle>
            Endpoint created. Copy the signing secret now, it will not be shown again.
          </AlertTitle>
          <AlertDescription>
            <code className="break-all">{created.signingSecret}</code>
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
