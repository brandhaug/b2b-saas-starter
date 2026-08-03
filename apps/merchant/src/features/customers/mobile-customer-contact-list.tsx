import { useId, useMemo, useState } from 'react'
import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import { MobileSearchField } from '@/components/merchant-shell/mobile/mobile-search-field.tsx'
import {
  customerInitials,
  filterCustomerEntries,
  type CustomerDirectoryView
} from './mobile-customer-contact-model.ts'
import { useMobileEdgeScrollSpring } from './use-mobile-edge-scroll-spring.ts'

type CustomerEntry = CustomerRecord

export function MobileCustomerContactList({
  directory
}: {
  readonly directory: CustomerDirectoryView
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
        <MobileSearchField
          id={searchId}
          label="Search customers"
          placeholder="Search customers"
          value={query}
          clearLabel="Clear customer search"
          onValueChange={setQuery}
        />
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
            <li key={entry.id}>
              <CustomerContactRow entry={entry} />
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

function CustomerContactRow({ entry }: { readonly entry: CustomerEntry }) {
  const activityStamp = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(new Date(entry.lastActivityAt))

  return (
    <a
      href={`#${entry.id}`}
      aria-label={`${entry.displayName}, ${entry.preferredEmail ?? entry.preferredPhone ?? 'no preferred contact'}`}
      className="group flex min-h-[5.25rem] items-start gap-3 rounded-2xl px-2 py-2 transition-[background-color,transform] active:scale-[0.98] active:bg-muted/70"
    >
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
      >
        {customerInitials(entry.displayName)}
      </span>
      <span className="-mt-0.5 min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-base leading-6 font-medium">
            {entry.displayName}
          </span>
          <span className="shrink-0 text-xs leading-4 font-light text-muted-foreground">
            {activityStamp}
          </span>
        </span>
        <span className="block truncate text-[0.9375rem] leading-[1.375rem] font-medium text-muted-foreground">
          {entry.preferredEmail ?? 'No email'}
        </span>
        <span className="block truncate text-sm leading-5 font-light text-muted-foreground/80">
          {entry.preferredPhone ?? 'No phone number'}
        </span>
      </span>
    </a>
  )
}
