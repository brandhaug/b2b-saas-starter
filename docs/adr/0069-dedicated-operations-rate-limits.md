# Use dedicated Operations rate limits

The Operations Worker has separate configurable rate-limit categories for session/read traffic, sign-in and TOTP writes, Merchant discovery, operator invitations and permission changes, impersonation starts, and handoff exchange. Sensitive limits combine network-source keys with operator, email, target, or ticket identifiers as applicable, and repeated failures emit audit events. Thresholds are deployment configuration tuned from telemetry rather than hard-coded domain policy.
