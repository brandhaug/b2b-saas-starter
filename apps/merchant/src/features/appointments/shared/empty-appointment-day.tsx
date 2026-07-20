export function EmptyAppointmentDay() {
  return (
    <div className="mt-8 rounded-lg border bg-card p-8 text-center">
      <p className="font-medium">No Appointments this day</p>
      <p className="mt-2 text-sm text-muted-foreground">
        Confirmed Appointments will appear here automatically.
      </p>
    </div>
  )
}
