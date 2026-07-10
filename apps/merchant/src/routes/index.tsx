import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { merchantAuthClient } from '@/lib/auth-client.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/')({
  beforeLoad: async ({ location }) => {
    await requireMerchantSession(location.href)
  },
  component: IndexPage
})

function IndexPage() {
  const router = useRouter()
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md border bg-card p-8">
        <p className="text-xs font-medium text-primary">Merchant App</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Merchant workspace
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Your Merchant App authentication is active. Continue to the current prototype
          surface while the production workspace is built.
        </p>
        <Link
          to="/prototype/minimum-merchant-surface"
          search={{ variant: 'A', screen: 'launch' }}
          className="mt-6 inline-flex h-9 items-center bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Open Merchant workspace
        </Link>
        <button
          type="button"
          className="mt-3 text-sm text-primary underline underline-offset-4"
          onClick={() => {
            void merchantAuthClient.signOut().then(() => {
              router.history.push('/sign-in')
            })
          }}
        >
          Sign out
        </button>
      </div>
    </main>
  )
}
