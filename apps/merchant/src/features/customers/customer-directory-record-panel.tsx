import { CustomerDirectorySplitPanel } from './customer-directory-split-panel.tsx'
import type { CustomerDirectoryWorkspaceModel } from './use-customer-directory-workspace.ts'

export function CustomerDirectoryRecordPanel({
  workspace
}: {
  readonly workspace: CustomerDirectoryWorkspaceModel
}) {
  const {
    selected,
    possibleDuplicates,
    busy,
    message,
    edit,
    note,
    ban,
    merge,
    setContactStatus,
    recordConsent,
    liftBan,
    toggleArchive
  } = workspace

  return (
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
          {selected.contacts.some((contact) => contact.kind === 'phone') ||
          selected.consent.length ? (
            <section
              aria-label="Operational mobile consent"
              className="rounded-xl border p-3 text-sm"
            >
              <p className="font-medium">Operational mobile permission</p>
              <p className="text-xs text-muted-foreground">
                Record only evidence obtained through the approved permission wording.
              </p>
              {selected.contacts
                .filter(
                  (contact) => contact.kind === 'phone' && contact.status === 'active'
                )
                .map((contact) => (
                  <div key={contact.value} className="mt-2 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs">
                      {contact.value}
                      {contact.preferred ? ' · preferred' : ''}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        recordConsent(
                          {
                            purpose: 'operational_mobile',
                            destination: contact.value
                          },
                          false
                        )
                      }
                      className="rounded-lg border px-2 py-1"
                    >
                      Record permission
                    </button>
                  </div>
                ))}
              {selected.consent.map((evidence) => (
                <div
                  key={evidence.id}
                  className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <p className="min-w-0 flex-1">
                    {evidence.destination} · {evidence.purpose.replaceAll('_', ' ')} ·{' '}
                    {evidence.source} · wording {evidence.wordingVersion} ·{' '}
                    {evidence.withdrawnAt
                      ? `withdrawn ${evidence.withdrawnAt}`
                      : `granted ${evidence.grantedAt}`}
                  </p>
                  {!evidence.withdrawnAt ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => recordConsent(evidence, true)}
                      className="rounded-lg border px-2 py-1"
                    >
                      Record withdrawal
                    </button>
                  ) : null}
                </div>
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
            <select name="absorbedId" required className="h-10 rounded-xl border px-3">
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
          <CustomerDirectorySplitPanel workspace={workspace} />
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
  )
}
