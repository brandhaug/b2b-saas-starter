# Operations Abuse Protection

This adapter maps each Operations abuse category to its dedicated Cloudflare rate-limit
binding and records denied attempts through the global audit contract. Callers supply
raw subject and source keys; only opaque hashes may cross the limiter or audit boundary.

The handoff-exchange category is consumed by the Merchant App because that app owns the
ticket exchange endpoint, while remaining part of the Operations security boundary.
