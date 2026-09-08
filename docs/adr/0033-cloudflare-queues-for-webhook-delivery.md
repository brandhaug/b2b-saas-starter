# Cloudflare Queues for webhook delivery

Cloudflare Queues move outbound HTTP calls and retries off mutation request paths. D1 owns endpoint configuration and delivery evidence; the background worker dispatches queued messages and records outcomes. Ordinary event publication is best-effort. Explicit test-send and replay requests report unavailable or failed enqueueing so operators do not mistake a pending row for a confirmed send.
