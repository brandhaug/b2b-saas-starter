# Persisted audit events

The starter includes a simple persisted audit event table from the start. Audit events should record security, admin, workspace membership, billing, API token, and webhook actions so the reference app supports B2B governance expectations and creates a foundation for safer future capabilities such as impersonation.

## Individual event inspection

The audit page addresses an event with the `event` search parameter. The
capability's `get(id)` reads by both event ID and the resolved workspace ID,
independently of list filters and cursors. The web server function requires a
session and `auditLog: ['read']` before either read. A missing or foreign-workspace
event returns the same not-found panel; lack of audit permission remains an
explicit permission denial.
Store failures use the existing route error boundary and never masquerade as
missing events.

Details add the recorded actor user ID and an explicit metadata projection.
Only validated role, SSO protocol, delivery attempt count, HTTP response status,
and export size fields may cross this boundary. Unknown fields, nested payloads,
emails, names, IPs, URLs, scopes, and credentials remain private. Invalid approved
fields yield no metadata. Seed retains recorded metadata and applies the same
projection as Live; list and global reads continue to omit metadata entirely.
This is a web inspection feature, so it adds no REST endpoint or MCP catalog row.

The table follows the deterministic collection order from ADR 0057. Local column
sorting was removed because reordering one loaded page misrepresented the whole
collection. Native event links open the existing sheet, preserve list search
state, and push browser history. Close returns to the prior list entry for an
in-app open; a direct link closes by replacing only the event search parameter.
The sheet restores focus to the event link, or the actor filter when the event
is outside the visible list. No additional table or state framework is used.
