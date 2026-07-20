import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { ScreenResult } from '@/lib/server/operations.ts'

export function OperationsShell({
  eyebrow,
  title,
  children
}: {
  readonly eyebrow: string
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link
            className="font-semibold tracking-tight"
            search={{ merchantQuery: '', memberQuery: '' }}
            to="/"
          >
            Operations
          </Link>
          <nav aria-label="Operations navigation" className="flex gap-4 text-sm">
            <Link
              activeProps={{ 'aria-current': 'page' }}
              search={{ merchantQuery: '', memberQuery: '' }}
              to="/"
            >
              Discovery
            </Link>
            <Link
              activeProps={{ 'aria-current': 'page' }}
              search={{ result: undefined, error: undefined }}
              to="/operators"
            >
              Operators
            </Link>
            <Link activeProps={{ 'aria-current': 'page' }} to="/audit">
              Audit
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-8">{children}</div>
      </main>
    </div>
  )
}

export function ScreenState({
  result
}: {
  readonly result: Exclude<ScreenResult<never>, { state: 'ready' }>
}) {
  const copy = {
    unauthenticated: ['Session expired', 'Sign in again to continue.'],
    forbidden: [
      'Permission required',
      'Your current Operator Permissions do not allow this view.'
    ],
    'not-found': ['Not found', 'The requested Operations record is unavailable.'],
    unavailable: [
      'Operations unavailable',
      'The authoritative service could not complete this request. Try again shortly.'
    ]
  } as const
  const [title, message] = copy[result.state]
  return (
    <section className="max-w-xl border border-slate-200 bg-white p-6" role="alert">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">{message}</p>
      {result.state === 'unauthenticated' ? (
        <Link
          className="mt-5 inline-flex rounded bg-blue-700 px-4 py-2 text-sm text-white"
          search={{ error: undefined, result: undefined }}
          to="/sign-in"
        >
          Sign in
        </Link>
      ) : null}
    </section>
  )
}

export function Field({
  label,
  name,
  type = 'text',
  required = false,
  children
}: {
  readonly label: string
  readonly name: string
  readonly type?: string
  readonly required?: boolean
  readonly children?: ReactNode
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children ?? (
        <input
          className="h-10 rounded border border-slate-300 bg-white px-3"
          name={name}
          type={type}
          required={required}
        />
      )}
    </label>
  )
}

export function SubmitButton({ children }: { readonly children: ReactNode }) {
  return (
    <button
      className="h-10 rounded bg-blue-700 px-4 text-sm font-medium text-white"
      type="submit"
    >
      {children}
    </button>
  )
}

export function DefinitionList({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="grid gap-px overflow-hidden border border-slate-200 bg-slate-200 sm:grid-cols-2">
      {children}
    </dl>
  )
}

export function Fact({
  term,
  children
}: {
  readonly term: string
  readonly children: ReactNode
}) {
  return (
    <div className="bg-white p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {term}
      </dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  )
}
