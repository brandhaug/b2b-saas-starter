import { type EmailDeliveryRow } from '@/lib/server/email-delivery'
import { m } from '@b2b-saas-starter/i18n/messages'
import { DataTable, type DataTableColumnDef } from './data-table'
import { Panel } from './page/panel'
import { formatDateTime } from '@/lib/format-date'

function deliveryStatus(row: EmailDeliveryRow) {
  if (row.unconfirmed) {
    return m.email_delivery_unconfirmed()
  }
  switch (row.status) {
    case 'accepted': {
      return m.email_delivery_accepted()
    }
    case 'delivered': {
      return m.email_delivery_delivered()
    }
    case 'temporary_failure':
    case 'delayed': {
      return m.email_delivery_delayed()
    }
    case 'failed': {
      return m.email_delivery_failed()
    }
    case 'suppressed': {
      return m.email_delivery_suppressed()
    }
    case 'ambiguous': {
      return m.email_delivery_ambiguous()
    }
    case 'logged': {
      return m.email_delivery_logged()
    }
    case 'queued': {
      return m.email_delivery_queued()
    }
  }
}

function purposeLabel(purpose: EmailDeliveryRow['purpose']) {
  switch (purpose) {
    case 'verification': {
      return m.email_delivery_verification()
    }
    case 'recovery': {
      return m.email_delivery_recovery()
    }
    case 'security': {
      return m.email_delivery_security()
    }
    case 'invitation': {
      return m.email_delivery_invitation()
    }
    case 'notification': {
      return m.email_delivery_notification()
    }
    case 'digest': {
      return m.email_delivery_digest()
    }
  }
}

function failureReason(reason: string | null) {
  switch (reason) {
    case null: {
      return null
    }
    case 'hard_bounce': {
      return m.email_delivery_reason_hard_bounce()
    }
    case 'complaint': {
      return m.email_delivery_reason_complaint()
    }
    case 'provider_suppressed': {
      return m.email_delivery_reason_suppressed()
    }
    case 'provider_rejected': {
      return m.email_delivery_reason_rejected()
    }
    case 'temporary_failure': {
      return m.email_delivery_reason_temporary()
    }
    case 'transport_unavailable': {
      return m.email_delivery_reason_unavailable()
    }
    case 'timeout': {
      return m.email_delivery_reason_timeout()
    }
    case 'retry_window_expired': {
      return m.email_delivery_reason_expired()
    }
    case 'no_longer_relevant': {
      return m.email_delivery_reason_irrelevant()
    }
    default: {
      return null
    }
  }
}

function DeliveryStatus({ record }: { readonly record: EmailDeliveryRow }) {
  const reason = failureReason(record.reason)
  return (
    <div className="grid gap-1">
      <span>{deliveryStatus(record)}</span>
      {reason === null ? null : (
        <span className="text-sm text-muted-foreground">{reason}</span>
      )}
    </div>
  )
}

function deliveryColumns(): Array<DataTableColumnDef<EmailDeliveryRow>> {
  return [
    {
      accessorKey: 'providerMessageId',
      header: m.email_delivery_message_id(),
      cell: ({ row }) => (
        <span className="break-all font-mono">
          {row.original.providerMessageId ?? row.original.id}
        </span>
      )
    },
    { accessorKey: 'recipient', header: m.email_delivery_recipient() },
    {
      accessorKey: 'purpose',
      header: m.email_delivery_purpose(),
      cell: ({ row }) => purposeLabel(row.original.purpose)
    },
    {
      accessorKey: 'status',
      header: m.status(),
      cell: ({ row }) => <DeliveryStatus record={row.original} />
    },
    {
      accessorKey: 'updatedAt',
      header: m.email_delivery_updated(),
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">
          {formatDateTime(row.original.updatedAt)}
        </span>
      )
    }
  ]
}

export function EmailDeliveryPanel({
  records
}: {
  readonly records: ReadonlyArray<EmailDeliveryRow>
}) {
  return (
    <Panel
      title={m.email_delivery_title()}
      description={m.email_delivery_description()}
    >
      <DataTable
        columns={deliveryColumns()}
        data={records}
        pageSize={10}
        tableLabel={m.email_delivery_title()}
        emptyMessage={m.email_delivery_empty()}
      />
      <p className="text-sm text-muted-foreground">{m.email_delivery_warning()}</p>
    </Panel>
  )
}
