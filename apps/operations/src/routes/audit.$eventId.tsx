import { createFileRoute, Link } from '@tanstack/react-router'
import {
  DefinitionList,
  Fact,
  OperationsShell,
  ScreenState
} from '@/components/operations-ui.tsx'
import { getAuditEvent } from '@/lib/server/operations.ts'

export const Route = createFileRoute('/audit/$eventId')({
  loader: ({ params }) => getAuditEvent({ data: params.eventId }),
  component: AuditDetailPage
})

function AuditDetailPage() {
  const result = Route.useLoaderData()
  if (result.state !== 'ready')
    return (
      <OperationsShell eyebrow="Global evidence" title="Audit event">
        <ScreenState result={result} />
      </OperationsShell>
    )
  const event = result.data.event
  return (
    <OperationsShell eyebrow="Audit event" title={event.action}>
      <Link className="text-sm text-blue-700" to="/audit">
        ← Back to global audit
      </Link>
      <div className="mt-5">
        <DefinitionList>
          <Fact term="Result">{event.result}</Fact>
          <Fact term="Timestamp">{event.occurredAt}</Fact>
          <Fact term="Real operator">
            {event.actor?.displayName ?? 'Not applicable'}
          </Fact>
          <Fact term="Operator Session">
            {event.operatorSessionId ?? 'Not applicable'}
          </Fact>
          <Fact term="Target">{event.target?.displayName ?? 'Not applicable'}</Fact>
          <Fact term="Merchant">{event.merchant?.displayName ?? 'Not applicable'}</Fact>
          <Fact term="Retention">
            {event.retentionPolicy === 'impersonation-two-years'
              ? `Two years, through ${event.retainUntil ?? ''}`
              : 'Operations standard'}
          </Fact>
          <Fact term="Impersonation">{event.impersonationId ?? 'Not applicable'}</Fact>
          <Fact term="Internal reason">{event.internalReason ?? 'Not provided'}</Fact>
          <Fact term="Support reference">
            {event.supportReference ?? 'Not provided'}
          </Fact>
        </DefinitionList>
      </div>
    </OperationsShell>
  )
}
