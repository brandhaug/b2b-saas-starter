# Operations Impersonation Revocation

Security-state writers use these statements to terminate Active impersonations in the
same D1 batch as the authoritative role, enabled-state, Operator Session, or recovery
change. Every transition must revoke the derived Merchant Session and create one
sanitized target Notification Intent plus one stably attributed global audit event.

Selectors stay narrow and lifecycle updates remain conditional on `active`; retries and
concurrent decisions must not duplicate notification or audit evidence. Callers must
provide the configured security contact and preserve the independent normal Merchant
Session and Operator Session boundaries unless that Operator Session is itself the
revocation trigger.
