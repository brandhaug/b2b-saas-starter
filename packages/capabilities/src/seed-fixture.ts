import type { OperationalAppointment } from './booking/appointment-operations.ts'

/** Projects the canonical scenario into the richer Merchant operations view. */
export const deriveSeedOperationalAppointments = (input: {
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
  readonly appointments: ReadonlyArray<{
    readonly id: string
    readonly merchantId: string
    readonly providerId: string
    readonly status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
    readonly startsAt: string
    readonly endsAt: string
    readonly createdAt: string
    readonly customerDetails: {
      readonly name: string
      readonly email: string
      readonly phone: string | null
    }
  }>
}): ReadonlyArray<OperationalAppointment> =>
  input.appointments.map((appointment) => {
    const { customerDetails, ...record } = appointment
    return {
      ...record,
      snapshot: {
        startsAt: appointment.startsAt,
        endsAt: appointment.endsAt,
        providerPreference: { kind: 'any' },
        assignedProvider: input.provider,
        services: [
          {
            ...input.service,
            role: 'primary',
            beforeBufferMinutes: 0,
            afterBufferMinutes: 0
          }
        ],
        durationMinutes: input.service.durationMinutes,
        beforeBufferMinutes: 0,
        afterBufferMinutes: 0,
        occupiedStartsAt: appointment.startsAt,
        occupiedEndsAt: appointment.endsAt,
        currency: input.merchant.currency,
        totalMinor: input.service.priceMinor,
        merchantTimezone: input.merchant.timezone,
        customerDetails,
        checkoutPath: 'pay_in_person'
      }
    }
  })
