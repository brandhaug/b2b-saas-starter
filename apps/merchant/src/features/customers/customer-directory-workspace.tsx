import type { CustomerRecord } from '@b2b-saas-starter/capabilities/customer-directory'
import { customerInitials } from './customer-contact-model.ts'
import { useCustomerDirectoryWorkspace } from './use-customer-directory-workspace.ts'

export function CustomerDirectoryWorkspace({
  initialRecords
}: {
  readonly initialRecords: readonly CustomerRecord[]
}) {
  const {
    visible,
    query,
    setQuery,
    selectedId,
    setSelectedId,
    selected,
    possibleDuplicates,
    busy,
    message,
    importPreview,
    setImportPreview,
    edit,
    note,
    ban,
    merge,
    split,
    importRows,
    exportDirectory,
    setContactStatus,
    recordConsent,
    liftBan,
    toggleArchive
  } = useCustomerDirectoryWorkspace(initialRecords)

  return (
    <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(16rem,0.8fr)_minmax(24rem,1.2fr)]">
      <section aria-label="Customer Records" className="min-h-0 space-y-3">
        <div>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Customer Records"
            className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
          />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void exportDirectory()}
          className="rounded-xl border px-3 py-2 text-sm"
        >
          Export customer data
        </button>
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {visible.map((record) => (
            <li key={record.id}>
              <button
                type="button"
                onClick={() => setSelectedId(record.id)}
                aria-pressed={selectedId === record.id}
                className="flex min-h-16 w-full items-center gap-3 px-3 text-left aria-pressed:bg-muted"
              >
                <span className="grid size-9 place-items-center rounded-full bg-muted text-xs font-semibold">
                  {customerInitials(record.displayName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {record.displayName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {record.preferredEmail ??
                      record.preferredPhone ??
                      'No preferred contact'}
                  </span>
                </span>
                {record.ban ? (
                  <span className="rounded-full bg-destructive/10 px-2 py-1 text-xs text-destructive">
                    Banned
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={importRows} className="space-y-2 rounded-2xl border p-3">
          <label className="block text-sm font-medium" htmlFor="customer-import-rows">
            Import Customer Records
          </label>
          <textarea
            id="customer-import-rows"
            name="rows"
            placeholder="Name,email,phone — one customer per line"
            className="min-h-24 w-full rounded-xl border bg-background p-3 text-sm"
            onChange={() => setImportPreview(null)}
          />
          {importPreview ? (
            <ul aria-label="Import preview" className="text-xs text-muted-foreground">
              {importPreview.outcomes.map((row) => (
                <li key={row.row}>
                  Row {row.row}: {row.outcome.replaceAll('_', ' ')}
                </li>
              ))}
            </ul>
          ) : null}
          <button disabled={busy} className="rounded-xl border px-3 py-2 text-sm">
            {importPreview ? 'Import previewed rows' : 'Preview import'}
          </button>
        </form>
      </section>

      <section aria-label="Selected Customer Record" className="min-w-0">
        {selected ? (
          <div
            key={selected.id}
            className="space-y-5 rounded-2xl border border-border p-4"
          >
            <div>
              <h2 className="text-lg font-semibold">{selected.displayName}</h2>
              <p className="text-xs text-muted-foreground">
                Customer Record {selected.id} · revision {selected.revision}
              </p>
            </div>
            {message ? <output className="block text-sm">{message}</output> : null}
            <form onSubmit={edit} className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm sm:col-span-2">
                Name
                <input
                  name="name"
                  defaultValue={selected.displayName}
                  className="mt-1 h-10 w-full rounded-xl border px-3"
                />
              </label>
              <label className="text-sm">
                Preferred email
                <input
                  name="email"
                  type="email"
                  defaultValue={selected.preferredEmail ?? ''}
                  className="mt-1 h-10 w-full rounded-xl border px-3"
                />
              </label>
              <label className="text-sm">
                Preferred phone
                <input
                  name="phone"
                  defaultValue={selected.preferredPhone ?? ''}
                  className="mt-1 h-10 w-full rounded-xl border px-3"
                />
              </label>
              <button
                disabled={busy}
                className="rounded-xl bg-foreground px-3 py-2 text-sm text-background sm:col-span-2"
              >
                Save preferred details
              </button>
            </form>
            <form onSubmit={note} className="space-y-2">
              <label className="block text-sm" htmlFor="customer-note">
                Private Merchant Note
              </label>
              <textarea
                id="customer-note"
                name="note"
                className="min-h-20 w-full rounded-xl border p-3"
              />
              <button disabled={busy} className="rounded-xl border px-3 py-2 text-sm">
                Add note
              </button>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {selected.notes.map((entry) => (
                  <li key={entry.id}>
                    {entry.text} · {entry.actorId} · {entry.createdAt}
                  </li>
                ))}
              </ul>
            </form>
            {selected.contacts.length ? (
              <section aria-label="Customer contact history" className="space-y-2">
                <h3 className="text-sm font-medium">Contact history</h3>
                {selected.contacts.map((contact) => (
                  <div
                    key={`${contact.kind}:${contact.value}`}
                    className="flex flex-wrap items-center gap-2 rounded-xl border p-2 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {contact.kind}: {contact.value} · {contact.status}
                      {contact.preferred ? ' · preferred' : ''}
                    </span>
                    {contact.status === 'active' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setContactStatus(contact, 'disputed', false)}
                        className="rounded-lg border px-2 py-1"
                      >
                        Mark disputed
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setContactStatus(contact, 'active', true)}
                        className="rounded-lg border px-2 py-1"
                      >
                        Reactivate and prefer
                      </button>
                    )}
                  </div>
                ))}
              </section>
            ) : null}
            {selected.preferredPhone ? (
              <section
                aria-label="Operational mobile consent"
                className="rounded-xl border p-3 text-sm"
              >
                <p className="font-medium">Operational mobile permission</p>
                <p className="text-xs text-muted-foreground">
                  Record only evidence obtained through the approved permission wording.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => recordConsent(false)}
                    className="rounded-lg border px-2 py-1"
                  >
                    Record permission
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => recordConsent(true)}
                    className="rounded-lg border px-2 py-1"
                  >
                    Record withdrawal
                  </button>
                </div>
                {selected.consent
                  .filter(
                    (evidence) => evidence.destination === selected.preferredPhone
                  )
                  .map((evidence) => (
                    <p key={evidence.id} className="mt-2 text-xs text-muted-foreground">
                      {evidence.purpose.replaceAll('_', ' ')} · {evidence.source} ·{' '}
                      wording {evidence.wordingVersion} ·{' '}
                      {evidence.withdrawnAt
                        ? `withdrawn ${evidence.withdrawnAt}`
                        : `granted ${evidence.grantedAt}`}
                    </p>
                  ))}
              </section>
            ) : null}
            {selected.ban ? (
              <div className="rounded-xl border border-destructive/30 p-3 text-sm">
                <p className="font-medium">Booking ban active</p>
                <p className="text-muted-foreground">{selected.ban.reason}</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={liftBan}
                  className="mt-2 rounded-xl border px-3 py-2"
                >
                  Lift ban
                </button>
              </div>
            ) : (
              <form onSubmit={ban} className="grid gap-2 sm:grid-cols-2">
                <input
                  name="reason"
                  required
                  placeholder="Private ban reason"
                  className="h-10 rounded-xl border px-3"
                />
                <input
                  name="expiresAt"
                  type="datetime-local"
                  className="h-10 rounded-xl border px-3"
                />
                <button
                  disabled={busy}
                  className="rounded-xl border border-destructive px-3 py-2 text-sm text-destructive sm:col-span-2"
                >
                  Ban public booking
                </button>
              </form>
            )}
            <form onSubmit={merge} className="grid gap-2 sm:grid-cols-2">
              <select
                name="absorbedId"
                required
                className="h-10 rounded-xl border px-3"
              >
                <option value="">Merge possible duplicate…</option>
                {possibleDuplicates.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.displayName}
                  </option>
                ))}
              </select>
              <input
                name="reason"
                required
                placeholder="Merge reason"
                className="h-10 rounded-xl border px-3"
              />
              <label className="text-sm sm:col-span-2">
                Preferred details after merge
                <select
                  name="preferredDetailsSourceId"
                  defaultValue={selected.id}
                  className="mt-1 h-10 w-full rounded-xl border px-3"
                >
                  <option value={selected.id}>
                    {selected.displayName} (this record)
                  </option>
                  {possibleDuplicates.map((record) => (
                    <option key={record.id} value={record.id}>
                      {record.displayName} (duplicate)
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy}
                className="rounded-xl border px-3 py-2 text-sm sm:col-span-2"
              >
                Merge into this record
              </button>
            </form>
            <section aria-label="Customer Record history" className="space-y-2">
              <h3 className="text-sm font-medium">Attributed history</h3>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {selected.history.map((entry) => (
                  <li key={entry.id}>
                    {entry.kind.replaceAll('_', ' ')} · {entry.actorId} · {entry.at}
                    {entry.reason ? ` · ${entry.reason}` : ''}
                  </li>
                ))}
              </ul>
            </section>
            {selected.observations.length > 1 ? (
              <form onSubmit={split} className="space-y-2 rounded-xl border p-3">
                <p className="text-sm font-medium">
                  Split observations into a new record
                </p>
                {selected.observations.map((observation) => (
                  <label key={observation.id} className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="observationId"
                      value={observation.id}
                    />
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
                    <legend className="px-1 text-xs font-medium">
                      Move private notes
                    </legend>
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
                    <legend className="px-1 text-xs font-medium">
                      Move consent evidence
                    </legend>
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
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={toggleArchive}
              className="rounded-xl border px-3 py-2 text-sm"
            >
              {selected.status === 'archived' ? 'Restore record' : 'Archive record'}
            </button>
          </div>
        ) : (
          <p className="rounded-2xl border p-6 text-sm text-muted-foreground">
            Select a Customer Record.
          </p>
        )}
      </section>
    </div>
  )
}
