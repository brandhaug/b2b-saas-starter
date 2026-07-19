# Operations Impersonation

Starting impersonation is an authoritative D1 transaction. It rechecks the current
Operator Session, `merchant:impersonate`, recent TOTP presence, target identity and
Merchant membership, and both concurrency dimensions. Pending expiry and record
creation happen in the same transaction.

Only the one-way handoff ticket hash persists. The plaintext ticket may leave the
capability only in its successful result for the browser's later top-level POST; it
must never enter URLs, audit evidence, or ordinary logs.
