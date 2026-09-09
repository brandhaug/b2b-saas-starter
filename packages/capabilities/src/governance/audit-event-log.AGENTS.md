# Audit event log

Append-only audit stream. Add event and target names to `audit-event-taxonomy.ts` before using them.

- D1-writing capabilities use `auditedMutations`; `prepareRecord` builds an unexecuted insert for their batch. Plugin-backed mutations use `recordCompletedMutationAudit` (or `recordCompletedAudit` for identity-keyed actions) after the plugin call so a completed action remains successful when its audit write fails; the helper logs and emits `audit_write_gap`.
- Seed adapters that need to observe each other's events must share the layer instance built in `layers.ts`. Seed actor values are display names, matching Live's user join, never raw IDs.
- Workspace reads trust the caller's authenticated `WorkspaceContext`. Global reads include system events and require the System Admin boundary.
- Keep metadata off unsanitized wire projections; it may contain IPs, scopes, and personal data.
- Cursor decode failure returns an empty page. The default page size must not truncate an explicitly requested page.
