import { useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { walkInMerchantTransitions } from '@b2b-saas-starter/capabilities/walk-ins'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import {
  getWalkInQueue,
  getWalkInShops,
  transitionWalkInEntry
} from '@/lib/server/walk-in-lifecycle.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/walk-ins')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  loader: async () => {
    const shops = await getWalkInShops()
    return {
      shops,
      queues: await Promise.all(
        shops.map(async (shop) => ({
          shop,
          entries: await getWalkInQueue({ data: { shopId: shop.id } })
        }))
      )
    }
  },
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
      <div className="mt-8 grid gap-3">
        {queues.map(({ shop, entries }) => (
          <section className="grid gap-3" key={shop.id}>
            <h2 className="text-xl font-semibold">{shop.publicName}</h2>
            {entries.length === 0 ? <p>No one is waiting.</p> : null}
            {entries.map((entry) => (
              <article className="border bg-card p-4" key={entry.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">Position {entry.position}</p>
                    <p className="text-sm text-muted-foreground">
                      {entry.status} · {entry.projectedWaitMinutes} min ·{' '}
                      {entry.serviceId}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {walkInMerchantTransitions(entry.status).map((status) => (
                      <button
                        className="rounded-md border px-3 py-2 text-sm capitalize"
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
