# Strong Authentication

`StrongAuthentication` is the capability seam for current app-session assurance.
It reads the live session by both `userId` and `sessionId`, checks session expiry
and impersonation, and validates the stored factor evidence against the current
verified TOTP or passkey rows. `require` never treats recovery as protected
access. The Seed adapter fails closed; tests needing a qualified session must
provide an explicit test implementation.

Callers pass identifiers resolved by the app or OAuth issuer. They never pass a
raw session cookie, token, or factor secret. Keep ordinary workspace RBAC in
`authz`; this capability only answers whether a privileged human session has
current assurance.
