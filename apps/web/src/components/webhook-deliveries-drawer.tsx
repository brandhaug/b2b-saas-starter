import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { Fragment, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import { webhookDeliveryStatusVariant } from '@/lib/badge-variants'
import { formatUtcOr } from '@/lib/format-date'
import { viewerCan, type Viewer } from '@/lib/permissions'

export type ReplayDelivery = (input: {
  readonly data: {
    readonly workspaceSlug: string
    readonly deliveryId: string
  }
}) => Promise<{ readonly deliveryId: string }>

export type SendTestEvent = (input: {
  readonly data: {
    readonly workspaceSlug: string
    readonly endpointId: string
  }
}) => Promise<{ readonly deliveryId: string }>

function EvidenceRow({
  label,
  children
}: {
  readonly label: string
  readonly children: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-3xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  )
}

function DeliveryEvidence({ delivery }: { readonly delivery: WebhookDelivery }) {
  if (
    delivery.requestHeaders === null &&
    delivery.responseBody === null &&
    delivery.payload === null
  ) {
    return null
  }
  return (
    <dl className="grid gap-2">
      {delivery.payload === null ? null : (
        <EvidenceRow label="Payload">
          <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-3xs break-all whitespace-pre-wrap">
            {JSON.stringify(delivery.payload, null, 2)}
          </pre>
        </EvidenceRow>
      )}
      {delivery.requestHeaders === null ? null : (
        <EvidenceRow label="Request headers">
          <ul className="grid gap-0.5 font-mono text-3xs">
            {Object.entries(delivery.requestHeaders).map(([name, value]) => (
              <li key={name} className="min-w-0 break-all">
                <span className="text-muted-foreground">{name}:</span> {value}
              </li>
            ))}
          </ul>
        </EvidenceRow>
      )}
      {delivery.responseBody === null ? null : (
        <EvidenceRow label="Response body">
          <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-3xs break-all whitespace-pre-wrap">
            {delivery.responseBody === '' ? '(empty)' : delivery.responseBody}
          </pre>
        </EvidenceRow>
      )}
    </dl>
  )
}

/**
 * The per-endpoint deliveries drawer: one row per delivery attempt, newest
 * first, with the recorded evidence (payload, request headers, truncated
 * response body) and the operator actions — replay on failed rows, a test
 * send for the whole endpoint. The server fns re-check the permission; the
 * buttons here only hide what the role cannot do.
 */
export function WebhookDeliveriesDrawer({
  workspaceSlug,
  endpoint,
  open,
  onOpenChange,
  viewer,
  replayDelivery,
  sendTestEvent
}: {
  readonly workspaceSlug: string
  readonly endpoint: WebhookEndpoint & {
    readonly deliveries: ReadonlyArray<WebhookDelivery>
  }
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly viewer: Viewer
  readonly replayDelivery?: ReplayDelivery
  readonly sendTestEvent?: SendTestEvent
}) {
  // Which delivery row a replay was just queued for, so the row can show the
  // queued state until the loader refresh resolves the pending row in.
  const [queuedDeliveryId, setQueuedDeliveryId] = useState<string | null>(null)
  const [queuedTest, setQueuedTest] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const canReplay = viewerCan(viewer, { webhook: ['replay'] })
  const canTest = viewerCan(viewer, { webhook: ['test'] })

  async function replay(deliveryId: string) {
    if (replayDelivery === undefined) {
      return
    }
    setFailure(null)
    setQueuedDeliveryId(deliveryId)
    // `callServerFn`-shaped ports reject on failure; a rejected promise folds
    // into the drawer's failure message via the two-way `.then` below.
    const outcome = await replayDelivery({
      data: { workspaceSlug, deliveryId }
    }).then(
      () => null,
      () => 'Failed to queue the replay'
    )
    setQueuedDeliveryId(null)
    if (outcome !== null) {
      setFailure(outcome)
    }
  }

  async function sendTest() {
    if (sendTestEvent === undefined) {
      return
    }
    setFailure(null)
    setQueuedTest(true)
    const outcome = await sendTestEvent({
      data: { workspaceSlug, endpointId: endpoint.id }
    }).then(
      () => null,
      () => 'Failed to queue the test event'
    )
    setQueuedTest(false)
    if (outcome !== null) {
      setFailure(outcome)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 sm:max-w-md"
        data-testid="deliveries-drawer"
      >
        <SheetHeader>
          <SheetTitle className="break-all">Delivery attempts</SheetTitle>
          <SheetDescription className="break-all">{endpoint.url}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          {failure === null ? null : (
            <p className="text-xs text-destructive">{failure}</p>
          )}
          {canTest && endpoint.enabled ? (
            <>
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={queuedTest}
                  onClick={() => void sendTest()}
                >
                  {queuedTest ? <Spinner data-icon="inline-start" /> : null}
                  Send test event
                </Button>
                <p className="mt-1 text-3xs text-muted-foreground">
                  Queues a synthetic <code>webhook.test_event</code> to this endpoint.
                </p>
              </div>
              <Separator />
            </>
          ) : null}
          {endpoint.deliveries.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No delivery attempts yet. Events enqueue when something in the workspace
              subscribes.
            </p>
          ) : (
            <ol className="grid gap-0">
              {endpoint.deliveries.map((delivery, index) => {
                const replayable =
                  canReplay &&
                  endpoint.enabled &&
                  delivery.status !== 'delivered' &&
                  delivery.status !== 'pending' &&
                  delivery.payload !== null
                return (
                  <Fragment key={delivery.id}>
                    {index > 0 ? <Separator /> : null}
                    <li className="grid gap-2 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={webhookDeliveryStatusVariant(delivery.status)}>
                          {delivery.status}
                        </Badge>
                        <span className="font-mono text-xs">{delivery.eventType}</span>
                        {delivery.responseStatus === null ? null : (
                          <span className="font-mono text-xs">
                            HTTP {delivery.responseStatus}
                          </span>
                        )}
                      </div>
                      <p className="text-3xs text-muted-foreground">
                        attempt {delivery.attempts} ·{' '}
                        {formatUtcOr(delivery.lastAttemptAt, 'not attempted')}
                        {delivery.nextAttemptAt === null
                          ? null
                          : ` · next ${formatUtcOr(delivery.nextAttemptAt, '')}`}
                      </p>
                      {delivery.replayedFrom === null ? null : (
                        <p className="text-3xs text-muted-foreground">
                          Replayed from{' '}
                          <span className="font-mono">{delivery.replayedFrom}</span>
                        </p>
                      )}
                      <DeliveryEvidence delivery={delivery} />
                      {replayable ? (
                        <div>
                          <Button
                            variant="ghost"
                            size="xs"
                            disabled={queuedDeliveryId === delivery.id}
                            onClick={() => void replay(delivery.id)}
                          >
                            {queuedDeliveryId === delivery.id ? (
                              <Spinner data-icon="inline-start" />
                            ) : null}
                            Replay
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  </Fragment>
                )
              })}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
