import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: IndexPage })

function IndexPage() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-md border bg-card p-8">
        <p className="text-xs font-medium text-primary">Throwaway prototype</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          Minimum Merchant Surface
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Compare three route and screen plans for the first customer booking journey.
        </p>
        <Link
          to="/prototype/minimum-merchant-surface"
          search={{ variant: 'A', screen: 'launch' }}
          className="mt-6 inline-flex h-9 items-center bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Open prototype
        </Link>
      </div>
    </main>
  )
}
