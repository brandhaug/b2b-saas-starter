export type AppointmentCreateMode = 'appointment' | 'series' | 'record-completed'

export const appointmentCreateOptions: readonly {
  readonly mode: AppointmentCreateMode
  readonly label: string
}[] = [
  { mode: 'appointment', label: 'Appointment' },
  { mode: 'series', label: 'Appointment series' },
  { mode: 'record-completed', label: 'Record completed visit' }
]
