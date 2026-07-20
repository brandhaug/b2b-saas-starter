type MobileAppointmentSource = {
  readonly id: string
  readonly startsAt: string
  readonly status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  readonly snapshot: {
    readonly customerDetails: { readonly name: string }
    readonly services: ReadonlyArray<{ readonly name: string }>
  }
}

type MobileProviderGroup = {
  readonly provider: { readonly displayName: string }
  readonly appointments: ReadonlyArray<MobileAppointmentSource>
}

export type MobileWeekDay = {
  readonly date: string
  readonly day: string
  readonly weekday: string
  readonly selected: boolean
}

export type MobileAppointmentLedgerEntry = {
  readonly id: string
  readonly customerName: string
  readonly providerName: string
  readonly serviceNames: string
  readonly startsAt: string
  readonly status: MobileAppointmentSource['status']
  readonly time: string
}

export function mobileWeek(selectedDate: string): readonly MobileWeekDay[] {
  const selected = new Date(`${selectedDate}T12:00:00.000Z`)
  const mondayOffset = (selected.getUTCDay() + 6) % 7
  const monday = new Date(selected)
  monday.setUTCDate(selected.getUTCDate() - mondayOffset)

  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(monday)
    date.setUTCDate(monday.getUTCDate() + offset)
    const isoDate = date.toISOString().slice(0, 10)
    return {
      date: isoDate,
      day: String(date.getUTCDate()),
      weekday: new Intl.DateTimeFormat('en', {
        weekday: 'short',
        timeZone: 'UTC'
      }).format(date),
      selected: isoDate === selectedDate
    }
  })
}

export function mobileAppointmentLedger(
  groups: ReadonlyArray<MobileProviderGroup>,
  timezone: string
): readonly MobileAppointmentLedgerEntry[] {
  return groups
    .flatMap((group) =>
      group.appointments.map((appointment) => ({
        id: appointment.id,
        customerName: appointment.snapshot.customerDetails.name,
        providerName: group.provider.displayName,
        serviceNames: appointment.snapshot.services
          .map((service) => service.name)
          .join(', '),
        startsAt: appointment.startsAt,
        status: appointment.status,
        time: new Intl.DateTimeFormat('en-GB', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23'
        }).format(new Date(appointment.startsAt))
      }))
    )
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
}

export function mobileDateHeading(date: string) {
  const value = new Date(`${date}T12:00:00.000Z`)
  return {
    day: String(value.getUTCDate()),
    fullDate: new Intl.DateTimeFormat('en', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC'
    }).format(value)
  }
}
