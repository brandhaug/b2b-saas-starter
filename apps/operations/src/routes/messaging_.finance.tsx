import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import {
  Feedback,
  OperationsShell,
  ScreenState,
  SubmitButton
} from '@/components/operations-ui'
import { requireOperationsSession } from '@/lib/require-operations-session'
import {
  correctMessagingLedgerEntry,
  getMessagingFinance
} from '@/lib/server/operations-server-functions'

export const Route = createFileRoute('/messaging_/finance')({
  beforeLoad: requireOperationsSession,
  loader: () => getMessagingFinance(),
  component: MessagingFinanceRoute
})

function MessagingFinanceRoute() {
  const result = Route.useLoaderData()
  const router = useRouter()
  const [mutation, setMutation] =
    useState<Awaited<ReturnType<typeof correctMessagingLedgerEntry>>>()
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
            {providerCostTotals(result.data.providerCosts)}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Normalized cost facts retain their source currency and scale; they are not
            silently converted.
          </p>
        </div>
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Compensating ledger corrections</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          A correction appends an equal opposite entry. It cannot edit or delete the
          original.
        </p>
        <ul className="mt-4 grid gap-3">
          {result.data.ledgerEntries.map((entry) => (
            <li className="border border-border bg-card p-4" key={entry.entryId}>
              <div className="flex flex-col justify-between gap-2 sm:flex-row">
                <div>
                  <p className="font-medium capitalize">
                    {entry.kind.replaceAll('_', ' ')}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {entry.entryId} · {entry.shopId}
                  </p>
                </div>
                <p className="font-medium">
                  {entry.direction} {entry.amountMilliEuro} m€
                </p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {entry.occurredAt}
                {entry.reversed ? ' · already reversed' : ''}
              </p>
              {!entry.reversed && entry.kind !== 'correction' ? (
                <details className="mt-4 border-t border-border pt-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    Preview correction
                  </summary>
                  <form
                    className="mt-4 grid gap-4"
                    onSubmit={async (event) => {
                      event.preventDefault()
                      const form = new FormData(event.currentTarget)
                      const response = await correctMessagingLedgerEntry({
                        data: {
                          shopId: entry.shopId,
                          entryId: entry.entryId,
                          correctionReason: String(form.get('correctionReason') ?? ''),
                          reason: String(form.get('reason') ?? ''),
                          confirmed: form.get('confirmed') === 'yes'
                        }
                      })
                      setMutation(response)
                      if (response.state === 'ready') await router.invalidate()
                    }}
                  >
                    <div
                      aria-label="Correction preview"
                      className="grid gap-2 rounded-md bg-muted p-4 text-sm sm:grid-cols-2"
                    >
                      <p>
                        Before: {entry.direction} {entry.amountMilliEuro} m€
                      </p>
                      <p>
                        After: append{' '}
                        {entry.direction === 'credit' ? 'debit' : 'credit'}{' '}
                        {entry.amountMilliEuro} m€
                      </p>
                    </div>
                    <label className="grid gap-1.5 text-sm font-medium">
                      Stable correction code
                      <input
                        className="min-h-11 rounded-md border border-input bg-card px-3"
                        minLength={1}
                        name="correctionReason"
                        required
                      />
                    </label>
                    <label className="grid gap-1.5 text-sm font-medium">
                      Substantive reason
                      <textarea
                        className="min-h-24 rounded-md border border-input bg-card p-3"
                        minLength={12}
                        name="reason"
                        required
                      />
                    </label>
                    <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
                      <input name="confirmed" required type="checkbox" value="yes" />
                      Confirm compensating entry
                    </label>
                    <div>
                      <SubmitButton>Append correction</SubmitButton>
                    </div>
                  </form>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {mutation ? (
        <Feedback status={mutation.state === 'ready'}>
          {mutation.state === 'ready'
            ? 'Compensating entry appended.'
            : 'message' in mutation
              ? mutation.message
              : 'Finance state changed.'}
        </Feedback>
      ) : null}
    </OperationsShell>
  )
}

const providerCostTotals = (
  costs: readonly {
    readonly amountMinorUnits: number
    readonly currency: string
    readonly currencyScale: number
  }[]
) => {
  if (costs.length === 0) return '0 cost facts'
  const totals = new Map<string, number>()
  for (const cost of costs) {
    const amount = cost.amountMinorUnits / 10 ** cost.currencyScale
    totals.set(cost.currency, (totals.get(cost.currency) ?? 0) + amount)
  }
  return [...totals].map(([currency, amount]) => `${amount} ${currency}`).join(' · ')
}
