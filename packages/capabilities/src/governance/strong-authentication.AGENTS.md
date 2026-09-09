# Strong Authentication

`StrongAuthentication` is the capability seam for current app-session assurance.
It reads the live session by both `userId` and `sessionId`, checks session expiry
and impersonation, and validates the stored factor evidence against the current
verified TOTP or passkey rows. `require` permits twelve-hour strong proof;
`requireRecent` needs five-minute proof, allowing a password only for factorless
accounts. Recovery satisfies neither. The Seed adapter fails closed; tests needing a qualified session must
provide an explicit test implementation.

Callers pass identifiers resolved by the app or OAuth issuer. They never pass a
raw session cookie, token, or factor secret. Keep ordinary workspace RBAC in
`authz`, including which actions require recent authentication. This capability
evaluates authoritative session evidence without deciding permissions.
