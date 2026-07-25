import type { CustomerDirectory } from '@b2b-saas-starter/capabilities/booking'

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
