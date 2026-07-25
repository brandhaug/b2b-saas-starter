import type { CustomerDirectory } from '@b2b-saas-starter/capabilities/booking'

export type AppointmentClient = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly phone: string | null
  readonly source: 'directory' | 'draft'
  readonly draftProfile?: {
    readonly birthday: string | null
    readonly blockBooking: boolean
    readonly prepaidOnly: boolean
    readonly notes: string
  }
}

type CustomerEntry = CustomerDirectory['entries'][number]

export type AppointmentClientGroup = {
  readonly letter: string
  readonly entries: readonly CustomerEntry[]
}

const normalizedSearchValue = (value: string) => value.trim().toLocaleLowerCase()

const clientLetter = (name: string) => {
  const first = name.trim().charAt(0).toLocaleUpperCase()
  return /^[A-Z]$/.test(first) ? first : '#'
}

export const groupAppointmentClients = (
  entries: readonly CustomerEntry[],
  query: string
): readonly AppointmentClientGroup[] => {
  const normalizedQuery = normalizedSearchValue(query)
  const filtered = normalizedQuery
    ? entries.filter((entry) =>
        [entry.name, entry.email, entry.phone]
          .filter((value): value is string => Boolean(value))
          .some((value) => normalizedSearchValue(value).includes(normalizedQuery))
      )
    : entries

  const sorted = [...filtered].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  )
  const groups = new Map<string, CustomerEntry[]>()
  for (const entry of sorted) {
    const letter = clientLetter(entry.name)
    const group = groups.get(letter)
    if (group) group.push(entry)
    else groups.set(letter, [entry])
  }

  return [...groups.entries()]
    .sort(([left], [right]) => {
      if (left === '#') return 1
      if (right === '#') return -1
      return left.localeCompare(right)
    })
    .map(([letter, groupedEntries]) => ({ letter, entries: groupedEntries }))
}

export const appointmentClientFromDirectory = (
  entry: CustomerEntry
): AppointmentClient => ({
  id: entry.appointmentId,
  name: entry.name,
  email: entry.email,
  phone: entry.phone,
  source: 'directory'
})

export const makeDraftAppointmentClient = ({
  firstName,
  lastName,
  email,
  phone,
  birthday = '',
  blockBooking = false,
  prepaidOnly = false,
  notes = ''
}: {
  readonly firstName: string
  readonly lastName: string
  readonly email: string
  readonly phone: string
  readonly birthday?: string | undefined
  readonly blockBooking?: boolean | undefined
  readonly prepaidOnly?: boolean | undefined
  readonly notes?: string | undefined
}): AppointmentClient => ({
  id: `draft:${
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  }`,
  name: [firstName.trim(), lastName.trim()].filter(Boolean).join(' '),
  email: email.trim().toLocaleLowerCase(),
  phone: phone.trim() || null,
  source: 'draft',
  draftProfile: {
    birthday: birthday || null,
    blockBooking,
    prepaidOnly,
    notes: notes.trim()
  }
})
