# apps/background

Cloudflare Worker for recurring and queued work.

## Owned today

- **Catalog refresh** — cron at `0 6 * * *` (daily 06:00 UTC, `wrangler.jsonc`) calls `StarterModuleCatalog` and writes a `catalogRefreshRuns` row.
- **Webhook delivery** — Queue consumer for `b2b-saas-starter-webhooks` (with DLQ binding). Signs payloads with HMAC-SHA256 and persists attempt history to `webhookDeliveries` via `WebhookEndpoints`.

## Planned, not wired

- Email fan-out and report scheduling are referenced in the starter narrative but have no handlers in `src/index.ts` yet. Wire alongside their capability counterparts (`@b2b-saas-starter/email`, `implementation-reports`).

## Conventions

- Use Cloudflare Queues for retryable webhook work and D1 for delivery attempt history.
- Local development may direct-dispatch when queues are unavailable — follow the rate-limit fallback pattern in `apps/api/src/rate-limit.ts` when adding new queue consumers.
- `catalog-refresh.ts` is a CLI/test entry point — the scheduled handler lives in `src/index.ts`.
