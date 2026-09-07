# SSO policy

Recovery grants originate in the trusted operator tool. A user or System Admin endpoint must not mint them. Grant activation binds the stored owner and workspace to the authenticated session; browser input supplies only the grant ID.

Independent-factor evidence is written only after a successful authentication ceremony. Check the referenced factor's enrollment time against grant creation. Session age, an enabled MFA flag, or an SSO callback cannot establish independent authentication.

Grant state and its audit record commit together. Owner notifications retry from stored delivery markers and use per-owner deduplication keys. Expiry enforcement uses the clock on every access check, independently of the scheduled audit/notification sweep.

Seed and Live must agree on expiration, factor age, impersonation refusal, and repair-only access. The app binds session identity at its server boundary. API tokens remain exempt machine credentials; interactive MCP retains human session proof.

See [ADR 0077](../../../../docs/adr/0077-workspace-sso-policy-and-domain-claims.md).
