# Personal data export

The capability owns collection, the session-bound persistent archive, request/download audit evidence, and expiry. Its interface is `request(userId, sessionId)` followed by `download(userId, sessionId, exportId)`.

Archives are personal account records across all of the user's workspaces. Workspace-owned records and other users' data are excluded. OAuth output is limited to client metadata and consent scopes; secrets, credentials, access tokens, refresh tokens, and signing material are never selected.

Live artifacts are stored in D1 with cascading user/session foreign keys and a 24-hour expiry. Download rechecks the user/session pair and expiry before reading. Retention cleanup is approval-gated through the generic retention policy.

Seed binds in-memory artifacts to the requesting user/session pair and applies the same expiry. It has no authentication session store; callers must validate the current session at the authenticated boundary. Both web actions require the current session and recent authentication. Session revocation and account-deletion cascades are covered by Live tests.

The archive schema and renderer live in `personal-data-export-archive.ts`; Seed and Live adapters own their artifact lifecycle. Collection is private to request. Email history comes from `EmailDelivery.exportForUser`, which includes every sanitized personal record rather than the history page limit. Seed profiles, their D1 timestamps, and the fixture's sessions, linked accounts, OAuth clients, consents, and passkeys share `seed-fixture.ts` — every section is populated, because an adapter that hardcoded one empty would hand an account an archive missing what it holds. Each notification names its own workspace.

`personal-data-export.contract.ts` runs against both adapters: `personal-data-export.seed.test.ts` for Seed, `personal-data-export.live.test.ts` for Live, each planting its own subject.
