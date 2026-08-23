import {
  type WebhookDelivery,
  type WebhookEndpoint
} from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-endpoints.ts'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Cause, Effect, Exit, Option } from 'effect'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { WebhookForm, type CreateWebhookEndpoint } from '@/components/webhook-form'
import { causeMessage } from '@/lib/cause-message'
import { viewerCan, type Viewer } from '@/lib/permissions'
import {
  disableWebhookEndpointServerFn,
  rotateWebhookSecretServerFn
} from '@/lib/server/webhooks'

const DISABLE_FAILED = 'Failed to disable endpoint'
const ROTATE_FAILED = 'Failed to rotate secret'

/**
 * Mutating an endpoint, as a port. Injected rather than imported at the call
 * site so a test drives the panel with real functions of these shapes instead
 * of replacing the module they live in. The defaults are the production server
 * functions, so every caller but a test passes nothing.
 */
export type DisableWebhookEndpoint = (input: {
  readonly data: {
    readonly workspaceSlug: string
    readonly endpointId: string
  }
}) => Promise<boolean>

export type RotateWebhookSecret = (input: {
  readonly data: {
    readonly workspaceSlug: string
    readonly endpointId: string
  }
}) => Promise<string | null>

// An explicit locale and timezone keeps SSR and the browser in agreement.
function formatDate(iso: string | null): string {
  if (iso === null) return 'never'
  return new Date(iso).toLocaleString('en-US', { timeZone: 'UTC' })
}

// A fallback keeps unknown free-text statuses visible rather than crashing
// the render — the column is free-text by design.
type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'
function statusVariant(status: string): BadgeVariant {
  if (status === 'delivered') return 'default'
  if (status === 'failed') return 'secondary'
  return 'destructive'
}

function Deliveries({
  deliveries
}: {
  readonly deliveries: readonly WebhookDelivery[]
}) {
  if (deliveries.length === 0) {
    return <p className="text-xs text-muted-foreground">No delivery attempts yet.</p>
  }
  return (
    <ul className="grid gap-1">
      {deliveries.map((delivery) => (
        <li key={delivery.id} className="flex items-center gap-2 text-xs">
          <Badge variant={statusVariant(delivery.status)}>{delivery.status}</Badge>
          <span className="font-mono">{delivery.eventType}</span>
          <span className="text-muted-foreground">
            attempt {delivery.attempts}
            {delivery.responseStatus === null
              ? ''
              : ` · ${delivery.responseStatus}`} ·{' '}
            {formatDate(delivery.lastAttemptAt)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The workspace's webhook endpoints: create (secret shown once), list with
 * recent deliveries, disable, rotate secret. Presentation only — the controls
 * render when the role authorizes them, and every mutation is re-checked
 * server-side by `requireWorkspacePermission` in its server fn.
 */
export function WebhooksPanel({
  workspaceSlug,
  endpoints,
  viewer,
  disableEndpoint = disableWebhookEndpointServerFn,
  rotateSecret = rotateWebhookSecretServerFn,
  createEndpoint
}: {
  readonly workspaceSlug: string
  readonly endpoints: readonly (WebhookEndpoint & {
    readonly deliveries: readonly WebhookDelivery[]
  })[]
  readonly viewer: Viewer
  readonly disableEndpoint?: DisableWebhookEndpoint
  readonly rotateSecret?: RotateWebhookSecret
  readonly createEndpoint?: CreateWebhookEndpoint
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [rotatedSecret, setRotatedSecret] = useState<{
    readonly endpointId: string
    readonly secret: string
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const canCreate = viewerCan(viewer, { webhook: ['create'] })
  const canDisable = viewerCan(viewer, { webhook: ['disable'] })
  const canRotate = viewerCan(viewer, { webhook: ['rotateSecret'] })

  async function disable(endpointId: string) {
    setError(null)
    setBusy(endpointId)
    const exit = await Effect.runPromiseExit(
      Effect.tryPromise({
        try: () => disableEndpoint({ data: { workspaceSlug, endpointId } }),
        catch: (cause) => causeMessage(cause, DISABLE_FAILED)
      })
    )
    setBusy(null)
    if (Exit.isFailure(exit)) {
      setError(
        Option.getOrElse(Cause.findErrorOption(exit.cause), () => DISABLE_FAILED)
      )
      return
    }
    // The loader owns the list, so re-run it rather than mirroring the change
    // into local state.
    await router.invalidate()
  }

  async function rotate(endpointId: string) {
    setError(null)
    setRotatedSecret(null)
    setBusy(endpointId)
    const exit = await Effect.runPromiseExit(
      Effect.tryPromise({
        try: () => rotateSecret({ data: { workspaceSlug, endpointId } }),
        catch: (cause) => causeMessage(cause, ROTATE_FAILED)
      })
    )
    setBusy(null)
    if (Exit.isFailure(exit)) {
      setError(Option.getOrElse(Cause.findErrorOption(exit.cause), () => ROTATE_FAILED))
      return
    }
    // `null` means no endpoint matched in this workspace — nothing was
    // rotated and there is no secret to show.
    if (exit.value !== null) setRotatedSecret({ endpointId, secret: exit.value })
    await router.invalidate()
  }

  return (
    <div className="grid gap-6">
      {canCreate ? (
        <div className="grid gap-2">
          <h2 className="text-sm font-medium">Register an endpoint</h2>
          <WebhookForm
            workspaceSlug={workspaceSlug}
            onCreated={() => void router.invalidate()}
            {...(createEndpoint === undefined ? {} : { createEndpoint })}
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Your role cannot register endpoints.
        </p>
      )}

      <div className="grid gap-2">
        <h2 className="text-sm font-medium">Endpoints</h2>
        {endpoints.length === 0 ? (
          <p className="text-xs text-muted-foreground">No endpoints registered.</p>
        ) : (
          <ul className="grid gap-3">
            {endpoints.map((endpoint) => (
              <li
                key={endpoint.id}
                className="grid gap-2 rounded-md border border-border p-3"
              >
                <div className="grid gap-0.5">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <code className="break-all">{endpoint.url}</code>
                    {endpoint.enabled ? (
                      <Badge variant="outline">enabled</Badge>
                    ) : (
                      <Badge variant="secondary">disabled</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Success rate {endpoint.successRate}%
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {endpoint.events.map((event) => (
                      <Badge key={event} variant="outline">
                        {event}
                      </Badge>
                    ))}
                  </div>
                </div>

                <Deliveries deliveries={endpoint.deliveries} />

                {(canDisable || canRotate) && endpoint.enabled ? (
                  <div className="flex flex-wrap gap-2">
                    {canDisable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === endpoint.id}
                        onClick={() => void disable(endpoint.id)}
                      >
                        Disable
                        {busy === endpoint.id ? '…' : ''}
                      </Button>
                    ) : null}
                    {canRotate ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === endpoint.id}
                        onClick={() => void rotate(endpoint.id)}
                      >
                        Rotate secret
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {rotatedSecret?.endpointId === endpoint.id ? (
                  <div className="grid gap-1 p-3 text-xs">
                    <p className="font-medium">
                      Secret rotated. Copy it now, it will not be shown again.
                    </p>
                    <code className="break-all">{rotatedSecret.secret}</code>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
