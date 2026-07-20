# Operations Discovery

Read-only, platform-wide Merchant and Merchant Member support discovery. Every
operation receives only an Operator Session reference, re-authorizes
`merchant:read` from current D1 state, and returns the minimum accepted DTO.

Merchant Member detail requires an authoritative Merchant membership. Never
return credentials, full session tokens, unrelated Customer Details, or
unassociated platform identities. Impersonation eligibility is a current read
fact, not authority to start impersonation.
