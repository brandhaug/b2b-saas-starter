import type { CustomerDirectoryWorkspaceModel } from './use-customer-directory-workspace.ts'

export function CustomerDirectorySplitPanel({
  workspace
}: {
  readonly workspace: CustomerDirectoryWorkspaceModel
}) {
  const { selected, busy, split } = workspace
  if (!selected || selected.observations.length <= 1) return null

  return (
    <form onSubmit={split} className="space-y-2 rounded-xl border p-3">
      <p className="text-sm font-medium">Split observations into a new record</p>
      {selected.observations.map((observation) => (
        <label key={observation.id} className="flex gap-2 text-sm">
          <input type="checkbox" name="observationId" value={observation.id} />
          {observation.details.name} · {observation.appointmentId ?? 'import'}
        </label>
      ))}
      <fieldset className="grid gap-2 rounded-xl border p-2 sm:grid-cols-2">
        <legend className="px-1 text-xs font-medium">
          New record preferred details
        </legend>
        <input
          name="createdName"
          required
          defaultValue={selected.displayName}
          aria-label="New record name"
          className="h-10 rounded-xl border px-3 sm:col-span-2"
        />
        <input
          name="createdEmail"
          type="email"
          defaultValue={selected.preferredEmail ?? ''}
          aria-label="New record email"
          className="h-10 rounded-xl border px-3"
        />
        <input
          name="createdPhone"
          defaultValue={selected.preferredPhone ?? ''}
          aria-label="New record phone"
          className="h-10 rounded-xl border px-3"
        />
      </fieldset>
      {selected.contacts.length ? (
        <fieldset className="space-y-1 rounded-xl border p-2">
          <legend className="px-1 text-xs font-medium">
            Move contact destinations
          </legend>
          {selected.contacts.map((contact) => (
            <label
              key={`${contact.kind}:${contact.value}`}
              className="flex gap-2 text-xs"
            >
              <input
                type="checkbox"
                name="contactKey"
                value={`${contact.kind}:${contact.value}`}
                defaultChecked={contact.preferred}
              />
              {contact.kind}: {contact.value} · {contact.status}
            </label>
          ))}
        </fieldset>
      ) : null}
      {selected.notes.length ? (
        <fieldset className="space-y-1 rounded-xl border p-2">
          <legend className="px-1 text-xs font-medium">Move private notes</legend>
          {selected.notes.map((entry) => (
            <label key={entry.id} className="flex gap-2 text-xs">
              <input type="checkbox" name="noteId" value={entry.id} />
              {entry.text}
            </label>
          ))}
        </fieldset>
      ) : null}
      {selected.consent.length ? (
        <fieldset className="space-y-1 rounded-xl border p-2">
          <legend className="px-1 text-xs font-medium">Move consent evidence</legend>
          {selected.consent.map((entry) => (
            <label key={entry.id} className="flex gap-2 text-xs">
              <input type="checkbox" name="consentId" value={entry.id} />
              {entry.purpose.replaceAll('_', ' ')} · {entry.destination}
            </label>
          ))}
        </fieldset>
      ) : null}
      <input
        name="reason"
        required
        placeholder="Split reason"
        className="h-10 w-full rounded-xl border px-3"
      />
      <button disabled={busy} className="rounded-xl border px-3 py-2 text-sm">
        Create split record
      </button>
    </form>
  )
}
