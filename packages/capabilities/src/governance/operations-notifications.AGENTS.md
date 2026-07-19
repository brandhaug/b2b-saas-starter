# Operations Notifications

This capability owns durable global notification work for impersonation lifecycle
events. Claims are atomic, delivered intents are idempotent no-ops, and stale claims
are recoverable.

Notification records contain only target-facing facts: Merchant, event timestamp,
optional external support reference, and security contact. Never persist or deliver
the System Operator identity or internal Impersonation Reason here.
