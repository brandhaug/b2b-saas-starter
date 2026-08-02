# Shared capability foundation

This module owns reusable application policy, not product-specific decisions. Keep
authorization before mutation, use the same not-found result for unknown and
cross-Merchant resources, and commit command replay, revision, history, minimized
audit, and PII-free outbox work atomically. Runtime layers are always Live D1;
the deterministic adapter exists only for contract tests.
