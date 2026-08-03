import { ChevronRight, Search, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import {
  customerInitials,
  filterCustomerEntries,
  type CustomerDirectoryView
} from './customer-contact-model.ts'

type CustomerEntry = CustomerRecord

export function DesktopCustomerContactList({
  directory
}: {
  readonly directory: CustomerDirectoryView
}) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const entries = useMemo(
    () => filterCustomerEntries(directory.entries, query),
    [directory.entries, query]
  )

  return (
    <section
      aria-label="Customer contacts"
      data-desktop-customer-directory="true"
      className="flex min-h-full flex-col"
    >
      <div
        data-desktop-customer-search-header="true"
        className="sticky top-0 z-20 bg-background pb-3"
      >
        <div className="flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-muted-foreground">
          <Search aria-hidden className="size-4 shrink-0" strokeWidth={2} />
          <label htmlFor={searchId} className="sr-only">
            Search customers
          </label>
          <input
            id={searchId}
            data-desktop-customer-search="true"
            type="search"
            autoComplete="off"
            placeholder="Search customers"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 appearance-none bg-transparent text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear customer search"
              onClick={() => setQuery('')}
              className="grid size-6 shrink-0 place-items-center rounded-full bg-muted-foreground/15 active:scale-95"
            >
              <X aria-hidden className="size-3.5" strokeWidth={2.25} />
            </button>
          ) : null}
        </div>
      </div>

      {entries.length > 0 ? (
        <ul aria-label="Customers" className="-mx-2 divide-y divide-border/70">
          {entries.map((entry) => (
            <li key={entry.id}>
              <DesktopCustomerContactRow entry={entry} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid min-h-64 flex-1 place-items-center px-8 text-center">
          <div>
            <p className="text-sm leading-5 font-medium">
              {directory.entries.length === 0
                ? 'No customers yet'
                : 'No customers found'}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {directory.entries.length === 0
                ? 'Customer details appear here after an appointment is booked.'
                : 'Try a different name, email, or phone number.'}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

function DesktopCustomerContactRow({ entry }: { readonly entry: CustomerEntry }) {
  const activityStamp = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(entry.lastActivityAt))

  return (
    <a
      href={`#${entry.id}`}
      aria-label={`${entry.displayName}, ${entry.preferredEmail ?? entry.preferredPhone ?? 'no preferred contact'}`}
      data-desktop-customer-row="true"
      className="grid min-h-16 grid-cols-[2.25rem_minmax(0,1fr)_auto_1rem] items-center gap-3 rounded-xl px-2 py-2.5 transition-transform active:scale-[0.99] active:bg-muted/70"
    >
      <span
        aria-hidden
        className="grid size-9 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
      >
        {customerInitials(entry.displayName)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm leading-5 font-medium">
          {entry.displayName}
        </span>
        <span className="block truncate text-xs leading-5 text-muted-foreground">
          {entry.preferredEmail ?? 'No email'}
          {entry.preferredPhone ? ` · ${entry.preferredPhone}` : ''}
        </span>
      </span>
      <span className="w-28 whitespace-nowrap text-right text-xs leading-4 text-muted-foreground tabular-nums">
        {activityStamp}
      </span>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground/70" />
    </a>
  )
}
