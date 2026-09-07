# Workspace SSO policy and verified domain claims

Issue #287 replaces the domain-based password gate in ADR 0069 with a workspace access policy. Account sign-in remains available through other methods, but every protected human request to a workspace requiring SSO needs a session-bound proof from its current connection. API tokens remain machine credentials. Interactive MCP consent retains the originating session reference and cannot outlive its SSO proof.

Better Auth owns protocol configuration, exchanges, and cryptographic verification. The starter owns exact-domain claims, admission policy, connection generations, login-test evidence, and recovery exceptions. Protocol registration, updates, and deletion still use the plugin binding. Policy changes use audited D1 batches so replacement can retire the previous connection and activate the tested replacement together. Browser input cannot set policy fields through plugin endpoints.

The public auth mount does not expose `/organization/*`. Workspace operations use capability-backed server functions, which enforce the current session's workspace policy before invoking the plugin API internally. This closes raw organization reads and mutations without adding a second policy resolver for plugin request bodies. Account authentication and OAuth endpoints remain public.

One deployment-wide claim assigns an exact email domain to one workspace. Unverified configuration does not reserve a domain. Existing members and invitees may use the workspace's IdP, including contractors whose email domains differ. Optional verified-domain auto-join grants only member access. Daily DNS checks retain a fixed seven-day grace period after failure; expiry stops new SSO authentication without weakening the workspace requirement.

Recovery grants last one hour and require an existing owner to authenticate with an independently enrolled passkey or password plus MFA. A grant authorizes only SSO configuration repair. It does not authorize workspace data, token management, exports, or impersonation. Creation, use, and expiry are audited and notify owners.
