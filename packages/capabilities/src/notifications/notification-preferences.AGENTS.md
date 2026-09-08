# Notification preferences

Email preferences follow the user across workspaces (ADR 0061). Resolve defaults here so callers do not copy channel policy.

- Stored rows mean explicit user choices, even when the chosen channel equals its default. Do not seed default rows.
- Writes batch preference and audit together. Stored enum vocabularies come from `packages/db`; reuse them in schemas.
- Keep workspace IDs out of this identity-keyed service.
- Unsubscribe links land on signed-in account settings. Only the session-gated server function changes preferences; a one-click URL must not call `set`.
