import { createFileRoute, Link } from '@tanstack/react-router'
import {
  DefinitionList,
  Fact,
  OperationsShell,
  ScreenState
} from '@/components/operations-ui.tsx'
import { requireOperationsSession } from '@/lib/require-operations-session.ts'
import { getAuditEvent } from '@/lib/server/operations-server-functions.ts'

export const Route = createFileRoute('/audit_/$eventId')({
  beforeLoad: requireOperationsSession,
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
      <Link className="text-sm text-primary" to="/audit">
        ← Back to global audit
      </Link>
      <div className="mt-6">
        <DefinitionList>
          <Fact term="Result">{event.result}</Fact>
          <Fact term="Timestamp">
            <time className="font-mono" dateTime={event.occurredAt}>
              {event.occurredAt}
            </time>
          </Fact>
          <Fact term="Real operator">
            <AuditIdentity identity={event.actor} />
          </Fact>
          <Fact term="Operator Session">
            <span className="font-mono">
              {event.operatorSessionId ?? 'Not applicable'}
            </span>
          </Fact>
          <Fact term="Target">
            <AuditIdentity identity={event.target} />
          </Fact>
          <Fact term="Merchant">
            <AuditIdentity identity={event.merchant} />
          </Fact>
          <Fact term="Retention">
            {event.retentionPolicy === 'impersonation-two-years'
              ? `Two years, through ${event.retainUntil ?? ''}`
              : 'Operations standard'}
          </Fact>
          <Fact term="Impersonation">
            <span className="font-mono">
              {event.impersonationId ?? 'Not applicable'}
            </span>
          </Fact>
          <Fact term="Internal reason">{event.internalReason ?? 'Not provided'}</Fact>
          <Fact term="Support reference">
            {event.supportReference ?? 'Not provided'}
          </Fact>
        </DefinitionList>
      </div>
    </OperationsShell>
  )
}

function AuditIdentity({
  identity
}: {
  readonly identity: { readonly id: string; readonly displayName: string } | null
}) {
  return identity ? (
    <>
      {identity.displayName} <span className="font-mono">{identity.id}</span>
    </>
  ) : (
    <>Not applicable</>
  )
}
