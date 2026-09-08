# Defer API versioning

REST and MCP have no version prefix while the starter has no compatibility-bound external consumers. Introduce explicit versioning when a shipped contract must evolve without breaking an existing consumer. Prefer URL prefixes then: they remain visible in requests, routing, and reference URLs without coupling contract selection to credentials.
