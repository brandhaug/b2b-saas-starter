import { createFileRoute, Link } from '@tanstack/react-router'
import {
  DefinitionList,
  Fact,
  OperationsShell,
  ScreenState
} from '@/components/operations-ui.tsx'
import { getMerchant } from '@/lib/server/operations.ts'

export const Route = createFileRoute('/merchants/$merchantId')({
  loader: ({ params }) => getMerchant({ data: params.merchantId }),
  component: MerchantDetailPage
})

function MerchantDetailPage() {
  const result = Route.useLoaderData()
  if (result.state !== 'ready')
    return (
      <OperationsShell eyebrow="Merchant detail" title="Merchant unavailable">
        <ScreenState result={result} />
      </OperationsShell>
    )
  const merchant = result.data
  return (
    <OperationsShell eyebrow="Merchant detail" title={merchant.publicName}>
      <Link
        className="text-sm text-primary"
        search={{ merchantQuery: '', memberQuery: '' }}
        to="/"
      >
        ← Back to discovery
      </Link>
      <div className="mt-6">
        <DefinitionList>
          <Fact term="Merchant ID">
            <code>{merchant.id}</code>
          </Fact>
          <Fact term="Status">{merchant.status}</Fact>
          <Fact term="Public page">
            {merchant.publicPage.status === 'published'
              ? merchant.publicPage.bookingPath
              : 'Unpublished'}
          </Fact>
          <Fact term="Booking readiness">
            {merchant.readiness.ready
              ? 'Ready for publication'
              : `Incomplete: ${merchant.readiness.incomplete.join(', ')}`}
          </Fact>
        </DefinitionList>
      </div>
      <h2 className="mt-8 text-xl font-semibold">Members</h2>
      {merchant.members.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">No Merchant Members.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border border border-border bg-card">
          {merchant.members.map((member) => (
            <li className="p-4" key={member.id}>
              <Link
                className="font-medium text-primary"
                params={{ merchantId: merchant.id, memberId: member.id }}
                to="/merchants/$merchantId/members/$memberId"
              >
                {member.name}
              </Link>
              <p className="mt-1 text-sm text-muted-foreground">
                {member.email} · {member.role} · {member.status}
              </p>
            </li>
          ))}
        </ul>
      )}
    </OperationsShell>
  )
}
