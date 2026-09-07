# Account Preferences

## Purpose & Scope

`AccountPreferencesService` owns the identity keyed locale and IANA timezone preferences stored on the Better Auth user. A null locale or timezone is an intentional unset value; callers apply the shared i18n defaults when rendering.

## Entry Points & Contracts

- `get(userId)` returns the authoritative nullable preference pair.
- `set({ userId, locale?, timeZone?, initializeTimeZone? })` validates supplied values, writes only requested fields, audits changes, and rereads the row before returning it.
- `initializeTimeZone` is a first write: Live conditionally updates only when the stored timezone is null. Seed uses the same preserve existing value behavior.

## Usage Patterns

Authenticated server functions establish the request session before calling this service. Email and notification consumers use the returned or recipient saved locale and fall back to English for guests; timezone formatting falls back to UTC.

## Anti-patterns

- Do not accept an account id from an untrusted request body; derive it from the session.
- Do not write `user.locale` or `user.timeZone` directly from a route or worker.
- Do not treat a failed timezone parse as a default; return `AccountPreferencesRejected`.

## Dependencies & Edges

The contract depends on the DB user shape, the shared i18n locale union, and `AuditEventLog` through `auditedMutations`. Seed and Live layers are wired in `layers.ts`.

## Patterns & Pitfalls

Timezone values are bounded and checked with `Intl.DateTimeFormat`; persisted values must remain valid IANA names. Keep nullable storage intact so a browser can initialize a missing timezone atomically. Preference changes use the existing `auth.user_updated` audit event.
