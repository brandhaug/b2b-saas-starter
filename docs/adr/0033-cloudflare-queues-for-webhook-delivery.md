# Cloudflare Queues for webhook delivery

Outbound webhook delivery uses Cloudflare Queues so request paths stay fast and retryable delivery work runs in background infrastructure. D1 owns webhook endpoint configuration and delivery attempt history, while the queue/background worker handles dispatch and retry; local development may use direct dispatch when queue setup is unavailable.
