import { createFileRoute } from '@tanstack/react-router'
import { requireSession } from '@/lib/server/auth'
import { loadPurchaseServerFn } from '@/lib/server/purchase'
import { getTurnstileSiteKey } from '@/lib/server/turnstile'
import { purchaseIntent, purchaseSearch } from '@/lib/purchase-intent'
import { PurchasePage } from '@/components/purchase-page'
import { pageTitle } from '@/components/page/page-title'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/purchase')({
  validateSearch: purchaseSearch,
  loaderDeps: ({ search }) => ({ intent: purchaseIntent(search.plan) }),
  beforeLoad: async ({ location }) => ({
    session: await requireSession(location.href)
  }),
  loader: async ({ deps }) => ({
    purchase:
      deps.intent === null ? null : await loadPurchaseServerFn({ data: deps.intent }),
    turnstileSiteKey: await getTurnstileSiteKey()
  }),
  component: PurchaseRoute,
  head: () => ({ meta: [{ title: pageTitle(m.purchase_title()) }] })
})

function PurchaseRoute() {
  const { purchase, turnstileSiteKey } = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const intent = purchaseIntent(Route.useSearch().plan)
  return (
    <PurchasePage
      purchase={purchase}
      intent={intent}
      email={session.user.email}
      turnstileSiteKey={turnstileSiteKey}
    />
  )
}
