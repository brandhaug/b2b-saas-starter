import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle
} from '@/components/ui/item'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { WebhookForm, type CreateWebhookEndpoint } from '@/components/webhook-form'
import { ConfirmButton } from '@/components/confirm-button'
import { webhookDeliveryStatusVariant } from '@/lib/badge-variants'
import { viewerCan, type Viewer } from '@/lib/permissions'
import {
  disableWebhookEndpointServerFn,
  rotateWebhookSecretServerFn
} from '@/lib/server/webhooks'
import { callServerFn } from '@/lib/server-call'

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
          <Badge variant={webhookDeliveryStatusVariant(delivery.status)}>
            {delivery.status}
          </Badge>
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
  // Disabling an endpoint stops its deliveries with no re-enable control in
  // this surface, so it takes a click to arm and a second to commit — the same
  // two-step pattern the settings page's delete uses.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const canCreate = viewerCan(viewer, { webhook: ['create'] })
  const canDisable = viewerCan(viewer, { webhook: ['disable'] })
  const canRotate = viewerCan(viewer, { webhook: ['rotateSecret'] })

  async function disable(endpointId: string) {
    setError(null)
    setBusy(endpointId)
    const outcome = await callServerFn(
      () => disableEndpoint({ data: { workspaceSlug, endpointId } }),
      DISABLE_FAILED
    )
    setBusy(null)
    if (!outcome.ok) {
      setError(outcome.message)
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
    const outcome = await callServerFn(
      () => rotateSecret({ data: { workspaceSlug, endpointId } }),
      ROTATE_FAILED
    )
    setBusy(null)
    if (!outcome.ok) {
      setError(outcome.message)
      return
    }
    // `null` means no endpoint matched in this workspace — nothing was
    // rotated and there is no secret to show.
    if (outcome.value !== null) setRotatedSecret({ endpointId, secret: outcome.value })
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
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No endpoints registered</EmptyTitle>
              <EmptyDescription>Register one above to get started.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup>
            {endpoints.map((endpoint) => (
              <Item
                key={endpoint.id}
                variant="outline"
                size="sm"
                className="flex-col items-stretch"
              >
                <ItemContent>
                  <ItemTitle className="flex-wrap">
                    <code className="break-all">{endpoint.url}</code>
                    {endpoint.enabled ? (
                      <Badge variant="outline">enabled</Badge>
                    ) : (
                      <Badge variant="secondary">disabled</Badge>
                    )}
                  </ItemTitle>
                  <ItemDescription>
                    Success rate {endpoint.successRate}%
                  </ItemDescription>
                  <div className="flex flex-wrap gap-1">
                    {endpoint.events.map((event) => (
                      <Badge key={event} variant="outline">
                        {event}
                      </Badge>
                    ))}
                  </div>
                </ItemContent>

                <Deliveries deliveries={endpoint.deliveries} />

                {(canDisable || canRotate) && endpoint.enabled ? (
                  <ItemActions className="flex-wrap">
                    {canDisable ? (
                      <ConfirmButton
                        label="Disable"
                        confirmLabel="Confirm disable"
                        armed={confirmingId === endpoint.id}
                        busy={busy === endpoint.id}
                        onArm={() => setConfirmingId(endpoint.id)}
                        onCancel={() => setConfirmingId(null)}
                        onConfirm={() => void disable(endpoint.id)}
                      />
                    ) : null}
                    {canRotate ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === endpoint.id}
                        onClick={() => void rotate(endpoint.id)}
                      >
                        {busy === endpoint.id ? (
                          <Spinner data-icon="inline-start" />
                        ) : null}
                        Rotate secret
                      </Button>
                    ) : null}
                  </ItemActions>
                ) : null}

                {rotatedSecret?.endpointId === endpoint.id ? (
                  <>
                    <Separator />
                    <Alert>
                      <AlertTitle>
                        Secret rotated. Copy it now, it will not be shown again.
                      </AlertTitle>
                      <AlertDescription>
                        <code className="break-all">{rotatedSecret.secret}</code>
                      </AlertDescription>
                    </Alert>
                  </>
                ) : null}
              </Item>
            ))}
          </ItemGroup>
        )}
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
