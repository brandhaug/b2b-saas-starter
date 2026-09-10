import { statusLabel } from '@/lib/value-labels'
import { useState } from 'react'
import { type GlobalWebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { DataTable, DataTableContent, type DataTableColumnDef } from './data-table'
import { Panel } from './page/panel'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { formatDateTime } from '@/lib/format-date'
import { webhookDeliveryStatusVariant } from '@/lib/badge-variants'
import { useServerAction } from '@/hooks/use-server-action'
import {
  loadFailedDeliveriesServerFn,
  replayFailedDeliveryServerFn,
  type FailedDeliveriesPayload
} from '@/lib/server/admin'
import { m } from '@b2b-saas-starter/i18n/messages'

function ReplayAction({ delivery }: { readonly delivery: GlobalWebhookDelivery }) {
  // The queue's own answer to a replay: a refusal reason, or the id of the
  // copy it enqueued. Failures are the hook's; only these belong here.
  const [outcome, setOutcome] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)
  const replay = useServerAction(
    () => replayFailedDeliveryServerFn({ data: { deliveryId: delivery.id } }),
    {
      failureMessage: m.replay_failed(),
      invalidate: false,
      onSuccess: (result) => {
        if (result.status === 'refused') {
          setOutcome(result.reason)
          return
        }
        setQueued(true)
        setOutcome(m.replay_queued({ id: result.deliveryId }))
      }
    }
  )
  const message =
    replay.error === null ? outcome : `${replay.error} ${m.replay_pending_copy()}`
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="xs"
        disabled={replay.pending || queued}
        onClick={() => {
          setOutcome(null)
          replay.run(undefined)
        }}
        aria-label={m.replay_named({ id: delivery.id })}
      >
        {replay.pending ? m.replay_queuing() : m.replay_action()}
      </Button>
      {message ? (
        <output className="max-w-64 text-sm whitespace-normal">{message}</output>
      ) : null}
    </div>
  )
}

function columns(): Array<DataTableColumnDef<GlobalWebhookDelivery>> {
  return [
    {
      accessorKey: 'endpointUrl',
      header: m.endpoint_url(),
      cell: ({ row }) => (
        <div className="flex max-w-72 flex-col gap-2 whitespace-normal">
          <span className="font-mono break-all">{row.original.endpointUrl}</span>
          {row.original.endpointEnabled ? null : (
            <span>
              {m.delivery_endpoint_disabled({
                count: row.original.endpointConsecutiveFailures
              })}
              {row.original.endpointFailureLimitReached
                ? ` ${m.delivery_auto_disable_threshold()}`
                : null}
              {m.delivery_reenable_before_replay()}
            </span>
          )}
        </div>
      )
    },
    {
      id: 'workspace',
      header: m.common_workspaces(),
      cell: ({ row }) => (
        <div>
          {row.original.workspace.name}
          <div className="font-mono">{row.original.workspace.slug}</div>
        </div>
      )
    },
    { accessorKey: 'eventType', header: m.event_type_label() },
    {
      accessorKey: 'status',
      header: m.common_status(),
      cell: ({ row }) => (
        <Badge variant={webhookDeliveryStatusVariant(row.original.status)}>
          {statusLabel(row.original.status)}
        </Badge>
      )
    },
    { accessorKey: 'attempts', header: m.attempts_label() },
    {
      accessorKey: 'lastAttemptAt',
      header: m.last_attempt_label(),
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">
          {row.original.lastAttemptAt === null
            ? m.not_recorded()
            : formatDateTime(row.original.lastAttemptAt)}
        </span>
      )
    },
    {
      id: 'actions',
      header: m.replay_action(),
      cell: ({ row }) => <ReplayAction key={row.original.id} delivery={row.original} />
    }
  ]
}

export function AdminFailedDeliveries({
  initialPage
}: {
  readonly initialPage: FailedDeliveriesPayload
}) {
  const [page, setPage] = useState(initialPage)
  // `/admin` has no loader for this list, so the page it reads is local state
  // and the hook keeps its own invalidation out of the way.
  const deliveries = useServerAction(
    (cursor: string | undefined) =>
      loadFailedDeliveriesServerFn({
        data: cursor === undefined ? {} : { cursor }
      }),
    {
      failureMessage: m.load_failed_deliveries_failed(),
      invalidate: false,
      onSuccess: setPage
    }
  )
  return (
    <Panel
      title={m.failed_webhook_deliveries()}
      description={m.failed_webhook_deliveries_description()}
    >
      <DataTable
        columns={columns()}
        data={page.items}
        tableLabel={m.failed_webhook_deliveries()}
        emptyMessage={m.no_terminal_webhook_failures()}
      >
        <DataTableContent />
      </DataTable>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={deliveries.pending}
          onClick={() => deliveries.run(undefined)}
        >
          {m.refresh_newest()}
        </Button>
        <Button
          variant="outline"
          disabled={deliveries.pending || page.nextCursor === null}
          onClick={() => {
            if (page.nextCursor !== null) {
              deliveries.run(page.nextCursor)
            }
          }}
        >
          {m.older_failures()}
        </Button>
        {deliveries.pending ? <output>{m.loading_failures()}</output> : null}
      </div>
      {deliveries.error ? <p role="alert">{deliveries.error}</p> : null}
    </Panel>
  )
}
