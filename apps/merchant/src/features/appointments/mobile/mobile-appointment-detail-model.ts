import type { OperationalAppointment } from '@b2b-saas-starter/capabilities/booking'

export function mobileAppointmentPaymentLabel(
  appointment: Pick<OperationalAppointment, 'status' | 'snapshot'>
) {
  if (appointment.snapshot.checkoutPath === 'online_payment')
    return appointment.status === 'cancelled' ? 'Online payment' : 'Paid online'
  return appointment.status === 'scheduled' ? 'Due in person' : 'Pay in person'
}
