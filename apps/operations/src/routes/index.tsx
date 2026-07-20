import { createFileRoute, Link } from '@tanstack/react-router'
import type {
  MerchantMemberSearchResult,
  MerchantSearchResult
} from '@b2b-saas-starter/capabilities/operations'
import {
  OperationsShell,
  ScreenState,
  SubmitButton
} from '@/components/operations-ui.tsx'
import { getOperationsSession, searchOperations } from '@/lib/server/operations.ts'

type DiscoverySearch = { readonly merchantQuery: string; readonly memberQuery: string }

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): DiscoverySearch => ({
    merchantQuery:
      typeof search.merchantQuery === 'string'
        ? search.merchantQuery.slice(0, 100)
        : '',
    memberQuery:
      typeof search.memberQuery === 'string' ? search.memberQuery.slice(0, 100) : ''
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const session = await getOperationsSession()
    const discovery = deps.merchantQuery
      ? await searchOperations({
          data: { kind: 'merchant', query: deps.merchantQuery }
        })
      : deps.memberQuery
        ? await searchOperations({ data: { kind: 'member', query: deps.memberQuery } })
        : null
    return { session, discovery }
  },
  pendingComponent: () => (
    <OperationsShell eyebrow="Operations" title="Loading authoritative state…">
      <output>Checking your Operator Session.</output>
    </OperationsShell>
  ),
  component: OperationsHome
})

function OperationsHome() {
  const { session, discovery } = Route.useLoaderData()
  if (session.state !== 'ready')
    return (
      <OperationsShell eyebrow="Operations" title="Access state">
        <ScreenState result={session} />
      </OperationsShell>
    )
  const principal = session.data.principal
  return (
    <OperationsShell
      eyebrow="Protected Operations shell"
      title={`Welcome, ${principal.name}`}
    >
      <section className="grid gap-3 border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Dedicated identity
          </p>
          <p className="mt-1 font-mono text-sm">{principal.email}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Roles</p>
          <p className="mt-1 text-sm">{principal.roles.join(', ')}</p>
        </div>
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-semibold">Merchant discovery</h2>
        <p className="mt-1 text-sm text-slate-600">
          Search by Merchant id, public name, or slug; or by Member id, name, or email.
        </p>
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <SearchForm label="Find Merchants" name="merchantQuery" />
          <SearchForm label="Find Merchant Members" name="memberQuery" />
        </div>
      </section>
      {discovery ? <DiscoveryResults result={discovery} /> : null}
    </OperationsShell>
  )
}

function SearchForm({
  label,
  name
}: {
  readonly label: string
  readonly name: string
}) {
  return (
    <form className="grid gap-3 border border-slate-200 bg-white p-5" method="get">
      <label className="grid gap-1.5 text-sm font-medium">
        {label}
        <input
          className="h-10 rounded border border-slate-300 px-3"
          maxLength={100}
          name={name}
          required
        />
      </label>
      <SubmitButton>Search</SubmitButton>
    </form>
  )
}

function DiscoveryResults({
  result
}: {
  readonly result: Awaited<ReturnType<typeof searchOperations>>
}) {
  if (result.state !== 'ready')
    return (
      <section className="mt-8">
        <ScreenState result={result} />
      </section>
    )
  const results = result.data.results
  return (
    <section className="mt-8" aria-live="polite">
      <h2 className="text-xl font-semibold">Search results</h2>
      {results.length === 0 ? (
        <p className="mt-4 border border-slate-200 bg-white p-5 text-sm text-slate-600">
          No matching Merchants or Merchant Members.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-200 border border-slate-200 bg-white">
          {results.map((item) =>
            item.kind === 'merchant' ? (
              <MerchantResult key={item.id} result={item as MerchantSearchResult} />
            ) : (
              <MemberResult
                key={`${item.merchant.id}:${item.id}`}
                result={item as MerchantMemberSearchResult}
              />
            )
          )}
        </ul>
      )}
    </section>
  )
}

function MerchantResult({ result }: { readonly result: MerchantSearchResult }) {
  return (
    <li className="flex items-center justify-between gap-4 p-4">
      <div>
        <Link
          className="font-medium text-blue-700"
          params={{ merchantId: result.id }}
          to="/merchants/$merchantId"
        >
          {result.publicName}
        </Link>
        <p className="mt-1 font-mono text-xs text-slate-500">{result.slug}</p>
      </div>
      <span className="text-xs capitalize">{result.status}</span>
    </li>
  )
}

function MemberResult({ result }: { readonly result: MerchantMemberSearchResult }) {
  return (
    <li className="flex items-center justify-between gap-4 p-4">
      <div>
        <Link
          className="font-medium text-blue-700"
          params={{ merchantId: result.merchant.id, memberId: result.id }}
          to="/merchants/$merchantId/members/$memberId"
        >
          {result.name}
        </Link>
        <p className="mt-1 text-xs text-slate-500">
          {result.email} · {result.merchant.publicName}
        </p>
      </div>
      <span className="text-xs">
        {result.impersonationEligible ? 'Eligible' : 'Ineligible'}
      </span>
    </li>
  )
}
