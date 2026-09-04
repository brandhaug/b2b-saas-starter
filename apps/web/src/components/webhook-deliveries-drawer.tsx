import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { type WebhookEndpoint } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { Fragment } from 'react'

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
import { ActionFeedback } from '@/components/page/action-feedback'
import { webhookDeliveryStatusVariant } from '@/lib/badge-variants'
import { formatUtcOr } from '@/lib/format-date'
import { viewerCan, type Viewer } from '@/lib/permissions'
import {
  replayWebhookDeliveryServerFn,
  sendTestEventServerFn
} from '@/lib/server/webhooks'
import { useServerAction } from '@/hooks/use-server-action'

/**
 * Mutating a delivery, as a port. Defaulted to the production server
 * functions so every caller but a test passes nothing — the same convention
 * the webhooks panel's ports follow.
 */
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

const REPLAY_FAILED = 'Failed to queue the replay'
const TEST_FAILED = 'Failed to queue the test event'

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
  if (delivery.requestHeaders === null && delivery.responseBody === null) {
    return null
  }
  return (
    <dl className="grid gap-2">
      <EvidenceRow label="Payload">
        <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-3xs break-all whitespace-pre-wrap">
          {JSON.stringify(delivery.payload, null, 2)}
        </pre>
      </EvidenceRow>
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
 * buttons here only hide what the role cannot do. Each action is a
 * `useServerAction`: busy flag, failure copy, and the loader refresh that
 * resolves the replayed row into the list.
 */
export function WebhookDeliveriesDrawer({
  workspaceSlug,
  endpoint,
  open,
  onOpenChange,
  viewer,
  replayDelivery = replayWebhookDeliveryServerFn,
  sendTestEvent = sendTestEventServerFn
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
  const canReplay = viewerCan(viewer, { webhook: ['replay'] })
  const canTest = viewerCan(viewer, { webhook: ['test'] })

  const replay = useServerAction(
    (deliveryId: string) => replayDelivery({ data: { workspaceSlug, deliveryId } }),
    { failureMessage: REPLAY_FAILED }
  )
  const sendTest = useServerAction(
    () => sendTestEvent({ data: { workspaceSlug, endpointId: endpoint.id } }),
    { failureMessage: TEST_FAILED }
  )

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
          <ActionFeedback error={replay.error} />
          <ActionFeedback error={sendTest.error} />
          {canTest && endpoint.enabled ? (
            <>
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={sendTest.pending}
                  onClick={() => sendTest.run(undefined)}
                >
                  {sendTest.pending ? <Spinner data-icon="inline-start" /> : null}
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
                  delivery.status !== 'pending'
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
                            disabled={replay.pendingInput === delivery.id}
                            onClick={() => replay.run(delivery.id)}
                          >
                            {replay.pendingInput === delivery.id ? (
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
