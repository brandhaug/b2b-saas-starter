import {
  WEBHOOK_EVENT_TYPES,
  type CreatedWebhookEndpoint,
  type WebhookEventType
} from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-endpoints.ts'
import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { Cause, Effect, Exit, Option } from 'effect'

import { FormTextField } from '@/components/form-text-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
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
            <fieldset
              className="grid gap-2"
              aria-invalid={hasError}
              aria-describedby={hasError ? errorId : undefined}
            >
              <legend className="text-sm font-medium leading-none">Events</legend>
              <div className="flex flex-wrap gap-3">
                {WEBHOOK_EVENT_TYPES.map((eventType) => {
                  const checked = field.state.value.includes(eventType)
                  return (
                    <Label key={eventType} className="text-sm">
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
                    </Label>
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
        selector={(state): readonly [boolean, boolean] => [
          state.canSubmit,
          state.isSubmitting
        ]}
      >
        {([canSubmit, isSubmitting]) => (
          <Button type="submit" disabled={!canSubmit} className="justify-self-start">
            {isSubmitting ? 'Creating…' : 'Create endpoint'}
          </Button>
        )}
      </form.Subscribe>

      {created ? (
        <div className="grid gap-1 rounded-md border border-border bg-muted/40 p-3 text-xs">
          <p className="font-medium">
            Endpoint created. Copy the signing secret now, it will not be shown again.
          </p>
          <code className="break-all">{created.signingSecret}</code>
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
