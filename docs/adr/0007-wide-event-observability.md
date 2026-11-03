# Wide event observability

Each request or background invocation emits one structured event combining its outcome and relevant context. This makes a failed workflow inspectable without reconstructing it from unrelated log lines. Trace propagation, optional exports, and request scoping follow [ADR 0050](./0050-opentelemetry-export-scoped-per-invocation.md).

HTTP observation wraps the encoded response. `statusCode` records the HTTP status; `status` records `ok` or `error` for logs and RED metrics. Returned 5xx responses and failed Effects produce error events. `outcome` describes business results such as retries or partial delivery. Native Worker invocation records cover entry-point gates that reject before application observation.

Handlers accumulate request facts through the shared logger. Approved immutable actor, workspace and token-record IDs, resolved plan, billing outcomes and delivery counts survive console and OTLP serialization. Plan reads annotate their existing result without an extra billing query. Raw URLs, workspace slugs, credentials, customer content and provider exception messages remain excluded. Web child operations retain one-level sanitized context on their parent event, including when the handler rejects.

Scheduler check-ins, operator snapshots and independent evidence-gap signals remain separate operational events with deployment identity supplied by their caller. Local full-text email preview output is an explicit development exception; it must never become an allowed field in exported application telemetry.
