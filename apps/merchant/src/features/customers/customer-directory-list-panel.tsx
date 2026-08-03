import { customerInitials } from './customer-contact-model.ts'
import type { CustomerDirectoryWorkspaceModel } from './use-customer-directory-workspace.ts'

export function CustomerDirectoryListPanel({
  workspace
}: {
  readonly workspace: CustomerDirectoryWorkspaceModel
}) {
  const {
    visible,
    query,
    setQuery,
    selectedId,
    setSelectedId,
    busy,
    importPreview,
    setImportPreview,
    importRows,
    exportDirectory,
    showArchived,
    toggleArchivedRecords
  } = workspace

  return (
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
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggleArchivedRecords()}
        aria-pressed={showArchived}
        className="ml-2 rounded-xl border px-3 py-2 text-sm"
      >
        {showArchived ? 'Hide archived records' : 'Show archived records'}
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
  )
}
