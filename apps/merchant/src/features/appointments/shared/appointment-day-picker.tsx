export function AppointmentDayPicker({
  date,
  timezone,
  presentation
}: {
  readonly date: string
  readonly timezone: string
  readonly presentation: 'desktop' | 'mobile'
}) {
  return (
    <form
      className={
        presentation === 'mobile'
          ? 'mt-5 grid grid-cols-[1fr_auto] items-end gap-2 rounded-lg bg-muted p-3'
          : 'mt-6 flex items-end gap-3'
      }
      method="get"
    >
      <label className="grid gap-1.5 text-sm">
        Day in {timezone}
        <input
          className="h-10 min-w-0 rounded-md border bg-card px-3"
          type="date"
          name="date"
          defaultValue={date}
        />
      </label>
      <button
        className="h-10 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
        type="submit"
      >
        View
      </button>
    </form>
  )
}
