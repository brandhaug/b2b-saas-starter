import { useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import {
  type AuditEvent,
  type AuditEventDetail
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription
} from '@/components/ui/sheet'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { auditActorTypeLabel, auditEventLabel } from '@/lib/audit-labels'
import { formatDateTime } from '@/lib/format-date'
import { m } from '@b2b-saas-starter/i18n/messages'

export function AuditEventLink({ event }: { readonly event: AuditEvent }) {
  return (
    <Link
      id={`audit-event-${event.id}`}
      to="."
      search={(previous) => ({ ...previous, event: event.id })}
      state={{ auditEventOpened: true }}
      resetScroll={false}
      className="inline-flex min-h-11 items-center rounded-md text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-9"
      aria-label={m.inspect_audit_event({
        event: auditEventLabel(event.eventType),
        time: formatDateTime(event.createdAt)
      })}
    >
      {auditEventLabel(event.eventType)}
    </Link>
  )
}

export function AuditEventSheet({
  eventId,
  event,
  onClose
}: {
  readonly eventId: string | null
  readonly event: AuditEventDetail | null
  readonly onClose: () => void
}) {
  // Store the stable event id instead of the current element. The audit list
  // can be replaced when the detail loader resolves or history navigates;
  // holding the old DOM node leaves Base UI with a disconnected focus target.
  const returnFocusEventId = useRef<string | null>(null)
  useEffect(() => {
    if (eventId !== null) {
      returnFocusEventId.current = eventId
    }
  }, [eventId])
  return (
    <Sheet
      open={eventId !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <SheetContent
        className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        finalFocus={() => {
          const eventLink =
            returnFocusEventId.current === null
              ? null
              : document.getElementById(`audit-event-${returnFocusEventId.current}`)
          return eventLink ?? document.getElementById('audit-actor-filter')
        }}
      >
        <SheetHeader className="pr-16">
          <SheetTitle>{m.audit_event()}</SheetTitle>
          <SheetDescription>{m.audit_event_description()}</SheetDescription>
        </SheetHeader>
        {event ? (
          <EventDetails event={event} />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>{m.empty_event_not_found()}</EmptyTitle>
              <EmptyDescription>{m.mcp_event_unavailable()}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </SheetContent>
    </Sheet>
  )
}

function EventDetails({ event }: { readonly event: AuditEventDetail }) {
  const fields = [
    [m.event_label(), auditEventLabel(event.eventType)],
    [m.event_type_label(), event.eventType],
    [m.event_id_label(), event.id],
    [m.time_label(), event.createdAt],
    [m.actor_label(), event.actor],
    [m.actor_type_label(), auditActorTypeLabel(event.actorType)],
    [m.actor_user_id_label(), event.actorUserId ?? m.not_recorded()],
    [m.target_type_label(), event.targetType],
    [m.target_id_label(), event.targetId ?? m.not_recorded()]
  ]
  return (
    <div className="grid min-w-0 gap-6 p-4 pt-0 text-sm">
      <dl className="grid gap-4">
        {fields.map(([label, value]) => (
          <div key={label} className="grid gap-1">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      <section className="grid gap-2" aria-label={m.permitted_metadata()}>
        <h3 className="font-medium">{m.audit_metadata()}</h3>
        {Object.keys(event.metadata).length > 0 ? (
          <pre className="whitespace-pre-wrap bg-muted p-3 font-mono [overflow-wrap:anywhere]">
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        ) : (
          <p className="text-muted-foreground">{m.audit_no_metadata()}</p>
        )}
        <p className="text-muted-foreground">{m.audit_metadata_description()}</p>
      </section>
    </div>
  )
}
