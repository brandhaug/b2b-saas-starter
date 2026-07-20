# Operations Contracts

Transport-neutral contracts for staff Operations workstreams. Callers may pass
only an Operator Session reference; current identity, status, and composable
roles are resolved authoritatively from D1 by `OperationsAuthorization`.
Credentials, cookies, HTTP objects, and UI-derived authority do not cross this
seam.
