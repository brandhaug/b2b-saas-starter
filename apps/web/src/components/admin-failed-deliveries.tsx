import { statusLabel } from '@/lib/value-labels'
import { useState, useTransition } from 'react'
import { type GlobalWebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { DataTable, type DataTableColumnDef } from './data-table'
import { Panel } from './page/panel'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { formatDateTime } from '@/lib/format-date'
import { webhookDeliveryStatusVariant } from '@/lib/badge-variants'
import { callServerFn } from '@/lib/server-call'
import {
  loadFailedDeliveriesServerFn,
  replayFailedDeliveryServerFn,
  type FailedDeliveriesPayload
} from '@/lib/server/admin'
import { m } from '@b2b-saas-starter/i18n/messages'

function ReplayAction({ delivery }: { readonly delivery: GlobalWebhookDelivery }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)
  function replay() {
    startTransition(async () => {
      setMessage(null)
      const result = await callServerFn(
        () => replayFailedDeliveryServerFn({ data: { deliveryId: delivery.id } }),
        m.replay_failed()
      )
      if (!result.ok) {
        setMessage(`${result.message} ${m.replay_pending_copy()}`)
        return
      }
      if (result.value.status === 'refused') {
        setMessage(result.value.reason)
        return
      }
      setQueued(true)
      setMessage(m.replay_queued({ id: result.value.deliveryId }))
    })
  }
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="xs"
        disabled={pending || queued}
        onClick={replay}
        aria-label={m.replay_named({ id: delivery.id })}
      >
        {pending ? m.replay_queuing() : m.replay_action()}
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
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  function load(cursor?: string) {
    startTransition(async () => {
      setError(null)
      const result = await callServerFn(
        () =>
          loadFailedDeliveriesServerFn({
            data: cursor === undefined ? {} : { cursor }
          }),
        m.load_failed_deliveries_failed()
      )
      if (!result.ok) {
        setError(result.message)
        return
      }
      setPage(result.value)
    })
  }
  return (
    <Panel
      title={m.failed_webhook_deliveries()}
      description={m.failed_webhook_deliveries_description()}
    >
      <DataTable
        columns={columns()}
        data={page.items}
        pageSize={20}
        pager={false}
        tableLabel={m.failed_webhook_deliveries()}
        emptyMessage={m.no_terminal_webhook_failures()}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={pending} onClick={() => load()}>
          {m.refresh_newest()}
        </Button>
        <Button
          variant="outline"
          disabled={pending || page.nextCursor === null}
          onClick={() => {
            if (page.nextCursor !== null) {
              load(page.nextCursor)
            }
          }}
        >
          {m.older_failures()}
        </Button>
        {pending ? <output>{m.loading_failures()}</output> : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </Panel>
  )
}
