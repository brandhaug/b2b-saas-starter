import { createFileRoute, Link } from '@tanstack/react-router'
import { OperationsShell, ScreenState } from '@/components/operations-ui'
import { requireOperationsSession } from '@/lib/require-operations-session'
import { getMessagingFinance } from '@/lib/server/operations-server-functions'

export const Route = createFileRoute('/messaging_/finance')({
  beforeLoad: requireOperationsSession,
  loader: () => getMessagingFinance(),
  component: MessagingFinanceRoute
})

function MessagingFinanceRoute() {
  const result = Route.useLoaderData()
  if (result.state !== 'ready')
    return (
      <OperationsShell eyebrow="Privileged messaging" title="Finance">
        <ScreenState result={result} />
      </OperationsShell>
    )
  return (
    <OperationsShell eyebrow="Privileged messaging" title="Finance">
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        Rate Cards are immutable and effective-dated. Corrections append compensating
        Messaging Balance entries; prior ledger history is never edited.
      </p>
      <Link
        className="mt-5 inline-flex min-h-9 items-center rounded-md border border-border px-3 text-sm font-medium"
        search={{ q: '' }}
        to="/messaging"
      >
        Back to case queue
      </Link>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Rate Cards</h2>
        <ul className="mt-4 grid gap-3">
          {result.data.rateCards.map((card) => (
            <li className="border border-border bg-card p-4" key={card.rateCardId}>
              <div className="flex flex-col justify-between gap-2 sm:flex-row">
                <div>
                  <p className="font-medium">Version {card.version}</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {card.rateCardId}
                  </p>
                </div>
                <p className="font-medium">{card.chargeMilliEuro} m€ excluding VAT</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Effective {card.effectiveAt}
                {card.retiredAt ? ` · retired ${card.retiredAt}` : ''}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Merchant balances</h2>
        {result.data.balances.length ? (
          <ul className="mt-4 grid gap-3">
            {result.data.balances.map((balance) => (
              <li className="border border-border bg-card p-4" key={balance.shopId}>
                <div className="flex flex-col justify-between gap-2 sm:flex-row">
                  <div>
                    <p className="font-medium">{balance.merchantName}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {balance.shopId}
                    </p>
                  </div>
                  <p className="font-medium">
                    {balance.availableMilliEuro} m€ available
                  </p>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {balance.postedMilliEuro} m€ posted · {balance.reservedMilliEuro} m€
                  reserved{balance.financiallyFrozen ? ' · financially frozen' : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 border border-border bg-card p-5 text-sm text-muted-foreground">
            No Messaging Balances.
          </p>
        )}
      </section>
      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Realized Merchant charges</h2>
          <p className="mt-3 text-2xl font-semibold">
            {result.data.charges.reduce(
              (total, charge) => total + charge.chargeMilliEuro,
              0
            )}{' '}
            m€
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.data.charges.length} Chargeable Deliveries
          </p>
        </div>
        <div className="border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Provider cost evidence</h2>
          <p className="mt-3 text-2xl font-semibold">
            {result.data.providerCosts.length}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Normalized cost facts retain their source currency and scale; they are not
            silently converted.
          </p>
        </div>
      </section>
    </OperationsShell>
  )
}
