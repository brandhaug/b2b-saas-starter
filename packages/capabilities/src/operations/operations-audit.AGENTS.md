# Global Operations Audit

Append-only, platform-wide evidence for staff Operations. Persist stable snapshots
without foreign keys so historical attribution survives deletion. Review requires the
current `impersonation-audit:read` permission. List responses exclude internal reasons
and support references; those fields are available only through authorized detail.

Producers use a stable business-event identifier for idempotency and may persist only
the explicit audit fields. Never add arbitrary metadata, credentials, session tokens,
handoff plaintext, TOTP secrets, backup codes, or observability logging here.
