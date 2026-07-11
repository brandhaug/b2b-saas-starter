import type { OperationalAppointment } from './booking/appointment-operations.ts'

export const makeSeedOperationalAppointments = (input: {
  readonly merchant: {
    readonly id: string
    readonly timezone: string
    readonly currency: string
  }
  readonly provider: { readonly id: string; readonly displayName: string }
  readonly service: {
    readonly id: string
    readonly name: string
    readonly durationMinutes: number
    readonly priceMinor: number
    readonly currency: string
  }
}): ReadonlyArray<OperationalAppointment> =>
  (['past', 'future'] as const).map((position) => {
    const startsAt =
      position === 'past' ? '2026-07-09T09:00:00.000Z' : '2026-07-11T09:00:00.000Z'
    const endsAt =
      position === 'past' ? '2026-07-09T09:30:00.000Z' : '2026-07-11T09:30:00.000Z'
    return {
      id: `apt_seed_${position}`,
      merchantId: input.merchant.id,
      providerId: input.provider.id,
      status: position === 'past' ? 'completed' : 'scheduled',
      startsAt,
      endsAt,
      snapshot: {
        startsAt,
        endsAt,
        providerPreference: { kind: 'any' },
        assignedProvider: input.provider,
        services: [{ ...input.service, role: 'primary' }],
        durationMinutes: input.service.durationMinutes,
        currency: input.merchant.currency,
        totalMinor: input.service.priceMinor,
        merchantTimezone: input.merchant.timezone,
        customerDetails: {
          name: position === 'past' ? 'Past Customer' : 'Future Customer',
          email: `${position}@example.com`,
          phone: null
        },
        checkoutPath: 'pay_in_person'
      },
      createdAt: '2026-07-08T09:00:00.000Z'
    }
  })
