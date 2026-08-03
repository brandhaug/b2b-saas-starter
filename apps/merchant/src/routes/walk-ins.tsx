import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { walkInMerchantTransitions } from '@b2b-saas-starter/capabilities/walk-ins'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import {
  getWalkInQueues,
  transitionWalkInEntry
} from '@/lib/server/walk-in-lifecycle.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/walk-ins')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  loader: async () => ({ queues: await getWalkInQueues() }),
  component: WalkInQueuePage
})

function WalkInQueuePage() {
  const { queues } = Route.useLoaderData()
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  return (
    <MerchantShell
      section={{ kind: 'merchant' }}
      title="Walk-in queue"
      description={
        queues.length > 0
          ? 'Manage every Shop queue from one authenticated view.'
          : 'No Shop is configured for this Merchant.'
      }
    >
      {message ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {message}{' '}
          <button
            className="underline"
            type="button"
            onClick={() => router.invalidate()}
          >
            Retry
          </button>
        </p>
      ) : null}
      <div className="mt-2 grid gap-4 md:mt-8 md:gap-3">
        {queues.map(({ shop, entries }) => (
          <section className="grid gap-2" key={shop.id}>
            <h2 className="px-1 text-sm leading-5 font-semibold md:px-0 md:text-xl">
              {shop.publicName}
            </h2>
            {entries.length === 0 ? (
              <p className="rounded-2xl border bg-muted/25 p-4 text-sm text-muted-foreground md:rounded-none md:bg-card">
                No one is waiting.
              </p>
            ) : null}
            {entries.map((entry) => (
              <article
                className="rounded-2xl border bg-muted/25 p-4 md:rounded-none md:bg-card"
                key={entry.id}
              >
                <div className="grid gap-3 md:flex md:flex-wrap md:items-center md:justify-between">
                  <div>
                    <p className="text-[0.9375rem] leading-[1.375rem] font-semibold md:text-base md:font-medium">
                      Position {entry.position}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {entry.status} · {entry.projectedWaitMinutes} min ·{' '}
                      {entry.serviceId}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 md:justify-end">
                    {walkInMerchantTransitions(entry.status).map((status) => (
                      <button
                        className="h-9 rounded-full border px-3 text-sm capitalize active:bg-muted md:rounded-md"
                        disabled={pending === entry.id}
                        key={status}
                        type="button"
                        onClick={() => {
                          setPending(entry.id)
                          setMessage(null)
                          void transitionWalkInEntry({
                            data: {
                              shopId: entry.shopId,
                              entryId: entry.id,
                              to: status
                            }
                          })
                            .then(() => router.invalidate())
                            .catch(() =>
                              setMessage(
                                'The queue changed before this action completed. Refresh and try again.'
                              )
                            )
                            .finally(() => setPending(null))
                        }}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </section>
        ))}
      </div>
    </MerchantShell>
  )
}
