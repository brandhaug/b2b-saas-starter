export function AppointmentEmailAttentionHealth({ count }: { readonly count: number }) {
  return (
    <div className="border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">Appointment email attention</p>
      <p className="mt-1 text-2xl font-semibold">{count}</p>
    </div>
  )
}
