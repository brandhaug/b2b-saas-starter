# Account deletion through Better Auth hooks

Better Auth's delete-user endpoint verifies the credential before invoking capability-owned teardown. The endpoint is enabled only when teardown hooks exist. `AccountLifecycle` refuses deletion by the sole owner of a shared workspace, deletes sole-member workspaces, and removes other memberships before detaching restrictive user references.

The before-delete hook rechecks the plan and aborts on failure, preventing a stale UI precheck or wrong password from authorizing teardown. The final account-deleted audit uses a null actor and the deleted ID as its target because the user row is gone. Post-delete audit and email are best-effort; plugin operations cannot form one transaction with the teardown. This remains a browser-session workflow.
