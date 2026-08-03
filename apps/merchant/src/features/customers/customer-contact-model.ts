import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'

export type CustomerDirectoryView = {
  readonly entries: readonly CustomerRecord[]
}

type CustomerEntry = CustomerRecord

const searchEvidence = (entry: CustomerEntry): readonly (string | null)[] => [
  entry.displayName,
  entry.preferredEmail,
  entry.preferredPhone,
  ...entry.contacts.map((contact) => contact.value),
  ...entry.observations.flatMap((observation) => [
    observation.details.name,
    observation.details.email,
    observation.details.phone
  ])
]

export const customerRecordMatchesQuery = (
  entry: CustomerEntry,
  query: string
): boolean => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  return searchEvidence(entry)
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
}

export const filterCustomerEntries = (
  entries: readonly CustomerEntry[],
  query: string
) => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return entries

  return entries.filter((entry) => customerRecordMatchesQuery(entry, normalizedQuery))
}

export const customerInitials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0]![0]!.toLocaleUpperCase()
  return `${words[0]![0] ?? ''}${words.at(-1)?.[0] ?? ''}`.toLocaleUpperCase()
}
