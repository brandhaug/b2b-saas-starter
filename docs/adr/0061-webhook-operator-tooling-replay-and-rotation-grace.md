# Webhook operator tooling: replay as linked rows and rotation with a signing grace window

Operator tooling for Webhook Endpoints — delivery history with recorded evidence, replay of failed deliveries, a synthetic test send, endpoint update/delete, and secret rotation with a 24-hour grace window — raised four design questions that share one answer: **the delivery log is append-only operator evidence, and the signing secret rotates by shifting, not replacing.**

## Replays are new rows, never edits

Replaying a failed delivery could mutate the original row (reset attempts, flip the status back). That would rewrite the very history an operator is inspecting. Instead, `replayDelivery` creates a **new** `pending` delivery row carrying the original's payload verbatim, `attempts: 0`, and a plain `replayedFrom` reference to the source row (a plain reference, not a foreign key — the original may be pruned while the replay is still worth listing). The audit trail reads "replayed X" against the new row id; the source row keeps its `dead_lettered` story forever. The plan is pure (`planReplayedDelivery` in the delivery plan module), so Seed and Live cannot drift.

## One row per message, upserted per attempt

The queue consumer derives (or, for replays and test sends, is handed) one delivery row id and calls `recordDeliveryAttempt` with it. Live persists with `onConflictDoUpdate` so every redelivery of the same message resolves the same row instead of dying on the primary key — and the `pending` row an operator action created is the row the consumer's first attempt updates. The `set` clause carries attempt state only (`status`, `attempts`, timestamps, `responseStatus`, `requestHeaders`, `responseBody`); `payload` and `replayedFrom` are insert-only, so a redelivery cannot erase a replay's provenance.

## Rotation shifts the secret; the sender dual-signs

Storing only the current secret makes rotation a cutover: between "rotate" and "the receiver installs the new secret", every delivery fails verification. Storing the replaced secret for a grace window and having the **sender** sign with both makes the window real: `rotateSecret` moves the current secret into `previous_signing_secret` with `previous_secret_expires_at = now + 24h`, and `getDispatchTarget` returns `activeSigningSecrets` — the current secret, plus the previous one until the window closes (inclusive of the stored instant, exclusive after). The consumer emits one `sha256=<hmac>` entry per active secret in `x-b2b-starter-signature`; a receiver verifies against every entry with every secret it holds and swaps its config within 24 hours. Rotating twice drops the original — only the last two secrets are ever active. The grace rule is pure (`activeSigningSecrets`, `planSecretRotation`), unit-tested at the boundary instants, and identical in both adapters.

## Evidence columns ride the delivery row

Replay needs the exact payload; diagnosis needs what was sent and what came back. The delivery row therefore carries `payload`, `requestHeaders` (the header block the worker posted), and a truncated `responseBody` (2 KiB with a visible marker). These are operator evidence, not an archive — truncation is declared in the state machine (`truncateResponseBody`), and success bodies are stored too, because "what did the receiver actually say" is not a failure-only question.

## Consequences

- The delivery log is append-only from the operator's perspective; nothing an operator does rewrites a row they can see.
- The queue message gains an optional `deliveryId` (the row to resolve) — optional, so ordinary fan-out keeps its deterministic `whd_<message id>` identity.
- Replay and test send enqueue through `WebhookPublisher.enqueue`, a pre-addressed single-message send beside the existing subscription fan-out; without a queue binding both stay provider-light (the `pending` row stands, nothing dispatches).
- A dead-lettered delivery now also records a broadcast workspace Notification (the capability calls `NotificationFeed.record`, which gains the identity-keyed `record` the background path needs); failed-permanent outcomes stay audit-only.
- New webhook permissions (`update`, `delete`, `replay`, `test`) join the statement set; `write`-scope tokens hold them because none can escalate the token's own authority, unlike `apiToken:create`.
