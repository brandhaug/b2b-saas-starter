import { Link } from '@tanstack/react-router'
import { ChevronRight, Search, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { CustomerDirectory } from '@b2b-saas-starter/capabilities/booking'
import { mobileSheetNavigationState } from '@/components/merchant-shell/mobile/mobile-sheet-gesture.ts'
import { formatAppointmentDateTime } from '@/lib/appointment-format.ts'
import { customerInitials, filterCustomerEntries } from './customer-contact-model.ts'

type CustomerEntry = CustomerDirectory['entries'][number]

const appointmentStampFormatters = new Map<string, Intl.DateTimeFormat>()

const appointmentStampFormatter = (timezone: string) => {
  const existing = appointmentStampFormatters.get(timezone)
  if (existing) return existing
  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
  appointmentStampFormatters.set(timezone, formatter)
  return formatter
}

export function DesktopCustomerContactList({
  directory
}: {
  readonly directory: CustomerDirectory
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
            <li key={entry.appointmentId}>
              <DesktopCustomerContactRow entry={entry} timezone={directory.timezone} />
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

function DesktopCustomerContactRow({
  entry,
  timezone
}: {
  readonly entry: CustomerEntry
  readonly timezone: string
}) {
  const appointmentLabel = formatAppointmentDateTime(entry.scheduledAt, timezone)
  const appointmentStamp = appointmentStampFormatter(timezone).format(
    new Date(entry.scheduledAt)
  )

  return (
    <Link
      to="/appointments/$appointmentId"
      viewTransition={false}
      state={mobileSheetNavigationState}
      params={{ appointmentId: entry.appointmentId }}
      search={{ date: entry.scheduledAt.slice(0, 10) }}
      aria-label={`${entry.name}, ${entry.email}, appointment ${appointmentLabel}`}
      data-desktop-customer-row="true"
      className="grid min-h-16 grid-cols-[2.25rem_minmax(0,1fr)_auto_1rem] items-center gap-3 rounded-xl px-2 py-2.5 transition-transform active:scale-[0.99] active:bg-muted/70"
    >
      <span
        aria-hidden
        className="grid size-9 place-items-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
      >
        {customerInitials(entry.name)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm leading-5 font-medium">
          {entry.name}
        </span>
        <span className="block truncate text-xs leading-5 text-muted-foreground">
          {entry.email}
          {entry.phone ? ` · ${entry.phone}` : ''}
        </span>
      </span>
      <span className="w-28 whitespace-nowrap text-right text-xs leading-4 text-muted-foreground tabular-nums">
        {appointmentStamp}
      </span>
      <ChevronRight aria-hidden className="size-4 text-muted-foreground/70" />
    </Link>
  )
}
