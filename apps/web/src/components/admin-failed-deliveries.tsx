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

function ReplayAction({ delivery }: { readonly delivery: GlobalWebhookDelivery }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [queued, setQueued] = useState(false)
  function replay() {
    startTransition(async () => {
      setMessage(null)
      const result = await callServerFn(
        () => replayFailedDeliveryServerFn({ data: { deliveryId: delivery.id } }),
        'Replay failed.'
      )
      if (!result.ok) {
        setMessage(
          `${result.message} A pending copy may already exist. Refresh before retrying.`
        )
        return
      }
      if (result.value.status === 'refused') {
        setMessage(result.value.reason)
        return
      }
      setQueued(true)
      setMessage(
        `Queued as ${result.value.deliveryId}. The original failure is retained.`
      )
    })
  }
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        size="xs"
        disabled={pending || queued}
        onClick={replay}
        aria-label={`Replay ${delivery.id}`}
      >
        {pending ? 'Queuing…' : 'Replay'}
      </Button>
      {message ? (
        <output className="max-w-64 text-sm whitespace-normal">{message}</output>
      ) : null}
    </div>
  )
}

const columns: Array<DataTableColumnDef<GlobalWebhookDelivery>> = [
  {
    accessorKey: 'endpointUrl',
    header: 'Endpoint',
    cell: ({ row }) => (
      <div className="flex max-w-72 flex-col gap-2 whitespace-normal">
        <span className="font-mono break-all">{row.original.endpointUrl}</span>
        {row.original.endpointEnabled ? null : (
          <span>
            Disabled · {row.original.endpointConsecutiveFailures} consecutive failures.
            {row.original.endpointFailureLimitReached
              ? ' Auto-disable threshold reached.'
              : null}
            Re-enable in the workspace before replay.
          </span>
        )}
      </div>
    )
  },
  {
    id: 'workspace',
    header: 'Workspace',
    cell: ({ row }) => (
      <div>
        {row.original.workspace.name}
        <div className="font-mono">{row.original.workspace.slug}</div>
      </div>
    )
  },
  { accessorKey: 'eventType', header: 'Event type' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge variant={webhookDeliveryStatusVariant(row.original.status)}>
        {row.original.status}
      </Badge>
    )
  },
  { accessorKey: 'attempts', header: 'Attempts' },
  {
    accessorKey: 'lastAttemptAt',
    header: 'Last attempt',
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        {row.original.lastAttemptAt === null
          ? 'Not recorded'
          : formatDateTime(row.original.lastAttemptAt)}
      </span>
    )
  },
  {
    id: 'actions',
    header: 'Replay',
    cell: ({ row }) => <ReplayAction key={row.original.id} delivery={row.original} />
  }
]

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
        'Could not load failed deliveries.'
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
      title="Failed webhook deliveries"
      description="Terminal failures across all workspaces, newest first, 20 per page. Sorting applies to this page. Replay sends a new delivery with the original payload."
    >
      <DataTable
        columns={columns}
        data={page.items}
        pageSize={20}
        pager={false}
        tableLabel="Failed webhook deliveries"
        emptyMessage="No terminal webhook failures on this page."
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={pending} onClick={() => load()}>
          Refresh newest
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
          Older failures
        </Button>
        {pending ? <output>Loading failures…</output> : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </Panel>
  )
}
