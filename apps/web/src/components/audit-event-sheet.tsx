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

export function AuditEventLink({ event }: { readonly event: AuditEvent }) {
  return (
    <Link
      id={`audit-event-${event.id}`}
      to="."
      search={(previous) => ({ ...previous, event: event.id })}
      state={{ auditEventOpened: true }}
      resetScroll={false}
      className="inline-flex min-h-11 items-center rounded-md text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:min-h-9"
      aria-label={`Inspect ${auditEventLabel(event.eventType)}, ${formatDateTime(event.createdAt)}`}
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
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (eventId !== null) {
      returnFocus.current =
        document.getElementById(`audit-event-${eventId}`) ??
        document.getElementById('audit-actor-filter')
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
        finalFocus={returnFocus}
      >
        <SheetHeader className="pr-16">
          <SheetTitle>Audit event</SheetTitle>
          <SheetDescription>Event details for this workspace.</SheetDescription>
        </SheetHeader>
        {event ? (
          <EventDetails event={event} />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>Event not found</EmptyTitle>
              <EmptyDescription>
                This event does not exist in this workspace or is no longer available.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </SheetContent>
    </Sheet>
  )
}

function EventDetails({ event }: { readonly event: AuditEventDetail }) {
  const fields = [
    ['Event', auditEventLabel(event.eventType)],
    ['Event type', event.eventType],
    ['Event ID', event.id],
    ['Time (UTC)', event.createdAt],
    ['Actor', event.actor],
    ['Actor type', auditActorTypeLabel(event.actorType)],
    ['Actor user ID', event.actorUserId ?? 'Not recorded'],
    ['Target type', event.targetType],
    ['Target ID', event.targetId ?? 'Not recorded']
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
      <section className="grid gap-2" aria-label="Permitted metadata">
        <h3 className="font-medium">Metadata</h3>
        {Object.keys(event.metadata).length > 0 ? (
          <pre className="whitespace-pre-wrap bg-muted p-3 font-mono [overflow-wrap:anywhere]">
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        ) : (
          <p className="text-muted-foreground">No permitted metadata recorded.</p>
        )}
        <p className="text-muted-foreground">
          Only approved operational fields are shown. Personal data, URLs, scopes, and
          credentials are withheld.
        </p>
      </section>
    </div>
  )
}
