# Workspace-configured SSO

Owners and admins manage workspace SSO connections through Better Auth's SSO plugin. The plugin owns OIDC/SAML protocol handling and provisioning; capabilities own connection lifecycle, sanitized reads, routing, and audits. Provisioning may grant member or admin, never owner.

Only enabled connections route sign-in. The auth boundary rejects disabled providers and enforces required SSO on the credential sign-in path; page redirects alone would not enforce either rule. OIDC setup resolves and validates discovery before registration so adding a public IdP does not require a deployment configuration change.

Connection writes use session-bound plugin adapters and cannot commit atomically with capability audits. DNS domain verification and SAML single logout remain disabled. Workspace administration does not prove control of an email domain, so a deployment needing exclusive domain claims must add verification before relying on them.
