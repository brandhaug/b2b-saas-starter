import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { ActionFeedback } from '@/components/page/action-feedback'
import { CreateSection, ListSection, Panel } from '@/components/page/panel'
import { Identifier } from '@/components/page/identifier'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { SecretReveal } from '@/components/secret-reveal'
import { webhookDeliveryStatusVariant } from '@/lib/badge-variants'
import { formatUtcOr } from '@/lib/format-date'
import { viewerCan, type Viewer } from '@/lib/permissions'
import {
  disableWebhookEndpointServerFn,
  replayWebhookDeliveryServerFn,
  rotateWebhookSecretServerFn,
  sendTestEventServerFn
} from '@/lib/server/webhooks'
import {
  WebhookDeliveriesDrawer,
  type ReplayDelivery,
  type SendTestEvent
} from '@/components/webhook-deliveries-drawer'
import { useServerAction } from '@/hooks/use-server-action'

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

function Deliveries({
  deliveries,
  onOpenDrawer
}: {
  readonly deliveries: ReadonlyArray<WebhookDelivery>
  readonly onOpenDrawer: () => void
}) {
  return (
    <div className="grid gap-2">
      <Button
        variant="ghost"
        size="xs"
        onClick={onOpenDrawer}
        aria-label={`Delivery attempts (${deliveries.length})`}
      >
        Delivery attempts ({deliveries.length})
      </Button>
      {deliveries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No delivery attempts yet.</p>
      ) : (
        <ul className="grid gap-1">
          {deliveries.slice(0, 3).map((delivery) => (
            <li key={delivery.id} className="flex items-center gap-2 text-xs">
              <Badge variant={webhookDeliveryStatusVariant(delivery.status)}>
                {delivery.status}
              </Badge>
              <span className="font-mono">{delivery.eventType}</span>
              <span className="text-muted-foreground">
                attempt {delivery.attempts}
                {delivery.responseStatus === null
                  ? ''
                  : ` · ${delivery.responseStatus}`}{' '}
                · {formatUtcOr(delivery.lastAttemptAt, 'never')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
  createEndpoint,
  replayDelivery = replayWebhookDeliveryServerFn,
  sendTestEvent = sendTestEventServerFn
}: {
  readonly workspaceSlug: string
  readonly endpoints: ReadonlyArray<
    WebhookEndpoint & {
      readonly deliveries: ReadonlyArray<WebhookDelivery>
    }
  >
  readonly viewer: Viewer
  readonly disableEndpoint?: DisableWebhookEndpoint
  readonly rotateSecret?: RotateWebhookSecret
  readonly createEndpoint?: CreateWebhookEndpoint
  readonly replayDelivery?: ReplayDelivery
  readonly sendTestEvent?: SendTestEvent
}) {
  const router = useRouter()
  const [rotatedSecret, setRotatedSecret] = useState<{
    readonly endpointId: string
    readonly secret: string
  } | null>(null)
  // Disabling an endpoint stops its deliveries with no re-enable control in
  // this surface, so it takes a click to arm and a second to commit — the same
  // two-step pattern the settings page's delete uses.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  // The endpoint whose deliveries drawer is open, if any.
  const [drawerEndpointId, setDrawerEndpointId] = useState<string | null>(null)

  const canCreate = viewerCan(viewer, { webhook: ['create'] })
  const canDisable = viewerCan(viewer, { webhook: ['disable'] })
  const canRotate = viewerCan(viewer, { webhook: ['rotateSecret'] })

  // The loader owns the list, so the hook re-runs it on success rather than
  // mirroring the change into local state.
  const disable = useServerAction(
    (endpointId: string) => disableEndpoint({ data: { workspaceSlug, endpointId } }),
    { failureMessage: DISABLE_FAILED }
  )

  const rotate = useServerAction(
    (endpointId: string) => rotateSecret({ data: { workspaceSlug, endpointId } }),
    {
      failureMessage: ROTATE_FAILED,
      // `null` means no endpoint matched in this workspace — nothing was
      // rotated and there is no secret to show.
      onSuccess: (secret, endpointId) => {
        setRotatedSecret(secret === null ? null : { endpointId, secret })
      }
    }
  )

  const busyId = disable.pendingInput ?? rotate.pendingInput ?? null
  const drawerEndpoint =
    endpoints.find((endpoint) => endpoint.id === drawerEndpointId) ?? null

  return (
    <Panel>
      <CreateSection
        allowed={canCreate}
        title="Register an endpoint"
        deniedReason="Your role cannot register endpoints."
      >
        <WebhookForm
          workspaceSlug={workspaceSlug}
          onCreated={() => void router.invalidate()}
          {...(createEndpoint === undefined ? {} : { createEndpoint })}
        />
      </CreateSection>

      <ListSection
        title="Endpoints"
        footer={
          <>
            {/* Stacked, not merged: each mutation's failure renders in its
                own alert, the same idiom the sessions panel uses. */}
            <ActionFeedback error={disable.error} />
            <ActionFeedback error={rotate.error} />
          </>
        }
      >
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
                    <Identifier>{endpoint.url}</Identifier>
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

                <Deliveries
                  deliveries={endpoint.deliveries}
                  onOpenDrawer={() => setDrawerEndpointId(endpoint.id)}
                />

                {(canDisable || canRotate) && endpoint.enabled ? (
                  <ItemActions className="flex-wrap">
                    {canDisable ? (
                      <ConfirmButton
                        label="Disable"
                        confirmLabel="Confirm disable"
                        armed={confirmingId === endpoint.id}
                        busy={busyId === endpoint.id}
                        onArm={() => setConfirmingId(endpoint.id)}
                        onCancel={() => setConfirmingId(null)}
                        onConfirm={() => disable.run(endpoint.id)}
                      />
                    ) : null}
                    {canRotate ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyId === endpoint.id}
                        onClick={() => {
                          setRotatedSecret(null)
                          rotate.run(endpoint.id)
                        }}
                      >
                        {busyId === endpoint.id ? (
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
                        <SecretReveal
                          secret={rotatedSecret.secret}
                          label="Webhook secret"
                          className="flex items-center gap-2"
                        />
                        <p className="mt-2 text-xs text-muted-foreground">
                          The replaced secret keeps signing deliveries for 24 hours, so
                          your receiver can swap it in without dropping anything.
                        </p>
                      </AlertDescription>
                    </Alert>
                  </>
                ) : null}
              </Item>
            ))}
          </ItemGroup>
        )}
      </ListSection>

      {drawerEndpoint === null ? null : (
        <WebhookDeliveriesDrawer
          workspaceSlug={workspaceSlug}
          endpoint={drawerEndpoint}
          open
          onOpenChange={(nextOpen) => {
            if (nextOpen) {
              return
            }
            setDrawerEndpointId(null)
          }}
          viewer={viewer}
          replayDelivery={replayDelivery}
          sendTestEvent={sendTestEvent}
        />
      )}
    </Panel>
  )
}
