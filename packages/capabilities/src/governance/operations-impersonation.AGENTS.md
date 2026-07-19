# Operations Impersonation

Starting impersonation is an authoritative D1 transaction. It rechecks the current
Operator Session, `merchant:impersonate`, recent TOTP presence, target identity and
Merchant membership, and both concurrency dimensions. Pending expiry and record
creation happen in the same transaction.

Only the one-way handoff ticket hash persists. The plaintext ticket may leave the
capability only in its successful result for the browser's later top-level POST; it
must never enter URLs, audit evidence, or ordinary logs.

Every protected Merchant request made with an Impersonated Merchant Session passes
through `OperationsImpersonationAuthority`. The capability rechecks the live operator,
Operator Session, TOTP enrollment, role, target, same-Merchant membership, Merchant,
session, and Active Impersonation Record before intersecting target authority with the
explicit action allowlist. Denied mutations and designated sensitive reads are audited;
routine reads are not. Merchant HTTP handlers must record the eventual result of every
allowed mutation against the returned authorization context.
