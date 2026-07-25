import { Link } from '@tanstack/react-router'
import { Search, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { CustomerDirectory } from '@b2b-saas-starter/capabilities/booking'
import { mobileSheetNavigationState } from '@/components/merchant-shell/mobile/mobile-sheet-gesture.ts'
import { formatAppointmentDateTime } from '@/lib/appointment-format.ts'
import { useMobileEdgeScrollSpring } from './use-mobile-edge-scroll-spring.ts'

type CustomerEntry = CustomerDirectory['entries'][number]

export const filterCustomerEntries = (
  entries: readonly CustomerEntry[],
  query: string
) => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return entries

  return entries.filter((entry) =>
    [entry.name, entry.email, entry.phone]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
  )
}

export const customerInitials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]![0]!.toLocaleUpperCase()
  return `${words[0]![0] ?? ''}${words.at(-1)?.[0] ?? ''}`.toLocaleUpperCase()
}

const formatCustomerAppointmentStamp = (instant: string, timezone: string) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    month: 'short',
    day: 'numeric'
  }).format(new Date(instant))

export function MobileCustomerContactList({
  directory
}: {
  readonly directory: CustomerDirectory
}) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const contactListRef = useMobileEdgeScrollSpring()
  const entries = useMemo(
    () => filterCustomerEntries(directory.entries, query),
    [directory.entries, query]
  )

  return (
    <section aria-label="Customer contacts" data-mobile-customer-directory="true">
      <div
        data-mobile-customer-search-header="true"
        className="relative sticky top-0 z-30 -mx-4 bg-background px-4 pb-2 before:absolute before:inset-x-0 before:-top-2 before:h-2 before:bg-background before:content-['']"
      >
        <div className="flex h-10 items-center gap-2 rounded-2xl bg-muted px-3 text-muted-foreground">
          <Search aria-hidden className="size-[1.125rem] shrink-0" strokeWidth={2} />
          <label htmlFor={searchId} className="sr-only">
            Search customers
          </label>
          <input
            id={searchId}
            type="search"
            inputMode="search"
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Search customers"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 appearance-none bg-transparent text-base leading-6 font-medium text-foreground outline-none placeholder:text-muted-foreground/80 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
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
        <ul
          ref={contactListRef}
          data-mobile-customer-list-spring="true"
          data-mobile-edge-spring="idle"
          className="-mx-2"
          aria-label="Customers"
        >
          {entries.map((entry) => (
            <li key={entry.appointmentId}>
              <CustomerContactRow entry={entry} timezone={directory.timezone} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="grid min-h-44 place-items-center px-6 text-center">
          <div>
            <p className="text-[0.9375rem] leading-[1.375rem] font-semibold">
              {directory.entries.length === 0
                ? 'No customers yet'
                : 'No customers found'}
            </p>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
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

function CustomerContactRow({
  entry,
  timezone
}: {
  readonly entry: CustomerEntry
  readonly timezone: string
}) {
  const appointmentLabel = formatAppointmentDateTime(entry.scheduledAt, timezone)
  const appointmentStamp = formatCustomerAppointmentStamp(entry.scheduledAt, timezone)

  return (
    <Link
      to="/appointments/$appointmentId"
      viewTransition={false}
      state={mobileSheetNavigationState}
      params={{ appointmentId: entry.appointmentId }}
      search={{ date: entry.scheduledAt.slice(0, 10) }}
      aria-label={`${entry.name}, ${entry.email}, appointment ${appointmentLabel}`}
      className="group flex min-h-[5.25rem] items-start gap-3 rounded-2xl px-2 py-2 transition-[background-color,transform] active:scale-[0.98] active:bg-muted/70"
    >
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
      >
        {customerInitials(entry.name)}
      </span>
      <span className="-mt-0.5 min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-base leading-6 font-medium">
            {entry.name}
          </span>
          <span className="shrink-0 text-xs leading-4 font-light text-muted-foreground">
            {appointmentStamp}
          </span>
        </span>
        <span className="block truncate text-[0.9375rem] leading-[1.375rem] font-medium text-muted-foreground">
          {entry.email}
        </span>
        <span className="block truncate text-sm leading-5 font-light text-muted-foreground/80">
          {entry.phone ?? 'No phone number'}
        </span>
      </span>
    </Link>
  )
}
