# Sensitive-surface rate limiting

Cloudflare Rate Limiting bindings protect auth exchanges, REST reads and writes, assistant calls, and MCP traffic. Rate limits are an abuse control, separate from plan entitlements. Each mutation tool also consumes the write bucket, so batching MCP calls cannot bypass per-operation enforcement. Configuration and bucket assignment live at the worker boundaries.
