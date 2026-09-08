# MCP client connections

User-keyed management of workspace-bound OAuth consent. Better Auth owns issuance and consent writes; this capability owns listing, audit, and revocation (ADR 0068).

- `getGrant` returns the consent ID/version and scopes for the user, client, and workspace. The MCP write guard compares this binding with the signed claim. Preserve the database version trigger: revocation and scope restoration in the same second must invalidate the old claim.
- Lists retain consents whose workspace was deleted, projecting a null workspace. These reads take a user ID, never a workspace slug.
- `recordGrant` audits separately because the plugin's HTTP write cannot join a D1 batch.
- Revocation batches consent deletion, access/refresh token revocation, and audit. Deleting only consent leaves minted tokens usable. A foreign consent ID matches nothing and emits no event.
- Consent workspace references are FK-free. For a deleted workspace, audit with `workspaceId: null` or the audit FK rejects the entire batch. A null consent `referenceId` must match tokens using `IS NULL`.
