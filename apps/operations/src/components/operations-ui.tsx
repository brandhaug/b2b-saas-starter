import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { AppSidebar } from '@/components/app-sidebar'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from '@/components/ui/breadcrumb'
import { Separator } from '@/components/ui/separator'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { useOperationsSignOut } from '@/hooks/use-operations-sign-out'
import type { ScreenResult } from '@/lib/server/operations-server-functions.ts'
import { ModeToggle } from './mode-toggle'

const screenStateCopy = {
  unauthenticated: ['Session expired', 'Sign in again to continue.'],
  expired: ['Enrollment expired', 'Sign in to resume incomplete security enrollment.'],
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
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/90 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1 min-h-9 min-w-9" />
            <Separator
              className="mr-2 data-[orientation=vertical]:h-4"
              orientation="vertical"
            />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink
                    className="inline-flex min-h-9 items-center"
                    render={
                      <Link search={{ merchantQuery: '', memberQuery: '' }} to="/" />
                    }
                  >
                    Operations
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="truncate">{title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>
          <div className="ml-auto pr-4">
            <ModeToggle />
          </div>
        </header>
        <div className="flex flex-1 flex-col p-4 pt-0">
          <div className="mx-auto w-full max-w-6xl py-8">
            <p className="text-sm font-medium text-primary">{eyebrow}</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
            <div className="mt-8">{children}</div>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export function AuthenticationShell({
  eyebrow,
  title,
  description,
  children
}: {
  readonly eyebrow: string
  readonly title: string
  readonly description?: string
  readonly children: ReactNode
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <section className="w-full max-w-lg border border-border bg-card p-6">
        <p className="text-sm font-medium text-primary">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-4 text-sm leading-6 text-muted-foreground">{description}</p>
        ) : null}
        {children}
      </section>
    </main>
  )
}

export function Feedback({
  children,
  status = false
}: {
  readonly children: ReactNode
  readonly status?: boolean
}) {
  const className =
    'mt-6 block rounded-md border border-border bg-muted p-4 text-sm text-foreground'
  return status ? (
    <output className={className}>{children}</output>
  ) : (
    <p className={className} role="alert">
      {children}
    </p>
  )
}

export function ScreenState({
  result
}: {
  readonly result: Exclude<ScreenResult<never>, { state: 'ready' }>
}) {
  const [title, message] = screenStateCopy[result.state]
  return (
    <section className="max-w-xl border border-border bg-card p-6" role="alert">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      {result.state === 'unauthenticated' || result.state === 'expired' ? (
        <Link
          className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
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
          className="h-9 rounded-md border border-input bg-card px-3"
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
      className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
      type="submit"
    >
      {children}
    </button>
  )
}

export function DefinitionList({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2">
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
    <div className="bg-card p-4">
      <dt className="text-sm font-medium text-muted-foreground">{term}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  )
}
