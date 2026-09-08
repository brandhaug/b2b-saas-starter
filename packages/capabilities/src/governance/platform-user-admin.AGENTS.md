# Platform user admin

System-level operations use explicit IDs and a per-call `PlatformUserAdminBinding` with session headers (ADR 0054).

- System Admin status grants no workspace authority. `changeWorkspaceRole` uses the admin's session and succeeds only where they also have the required workspace role. Preserve plugin refusals and reread the member after writing before claiming success.
- Refuse unknown accounts before calling the binding so no-op changes leave no audit. Impersonation also refuses self and System Admin targets, then notifies the target on success.
- Starting impersonation requires the real actor ID. Stopping takes it from `session.impersonatedBy`, never request input. The app supplies session state; this capability does not read cookies.
- `refuseWhileImpersonating` and the web endpoint mapping share the typed forbidden-action vocabulary.
- Keep `IMPERSONATION_SESSION_SECONDS` equal to `impersonationSessionDuration` in `packages/auth`, which cannot import this package.
- Seed permits one impersonation at a time, matching one admin cookie. Stopping another target must fail.
- Workspace-role audits retain the workspace ID so they also appear in its audit page.
