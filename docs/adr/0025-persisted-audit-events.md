# Persisted audit events

Security and administrative mutations record durable audit events so their evidence survives request logs. Workspace reads require audit permission and scope both list and individual-event queries to the workspace; foreign and missing IDs produce the same not-found result.

Individual inspection exposes only explicitly allowlisted metadata. Unknown fields, nested payloads, and identifying or credential data remain private; list and global reads omit metadata. Seed snapshots recorded metadata and applies the same projection as Live, preventing caller mutation from rewriting evidence. Storage failures remain errors rather than appearing as missing events.
