import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'

export type CustomerDirectoryView = {
  readonly entries: readonly CustomerRecord[]
}

type CustomerEntry = CustomerRecord

type SearchEvidence = {
  readonly value: string | null
  readonly kind: 'text' | 'phone'
}

const searchEvidence = (entry: CustomerEntry): readonly SearchEvidence[] => [
  { value: entry.displayName, kind: 'text' },
  { value: entry.preferredEmail, kind: 'text' },
  { value: entry.preferredPhone, kind: 'phone' },
  ...entry.contacts.map((contact) => ({
    value: contact.value,
    kind: contact.kind === 'phone' ? ('phone' as const) : ('text' as const)
  })),
  ...entry.observations.flatMap((observation) => [
    { value: observation.details.name, kind: 'text' as const },
    { value: observation.details.email, kind: 'text' as const },
    { value: observation.details.phone, kind: 'phone' as const }
  ])
]

export const customerRecordMatchesQuery = (
  entry: CustomerEntry,
  query: string
): boolean => {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return true
  const queryDigits = normalizedQuery.replace(/\D/g, '')
  const isPhoneQuery = /^[\d\s()+.-]+$/.test(normalizedQuery) && queryDigits.length >= 3
  return searchEvidence(entry)
    .filter((evidence): evidence is SearchEvidence & { readonly value: string } =>
      Boolean(evidence.value)
    )
    .some(
      (evidence) =>
        evidence.value.toLocaleLowerCase().includes(normalizedQuery) ||
        (evidence.kind === 'phone' &&
          isPhoneQuery &&
          evidence.value.replace(/\D/g, '').includes(queryDigits))
    )
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
