# Standard Webhooks and immutable delivery attempts

Webhook receivers need an interoperable signature protocol, and operators need to
see failures that a later successful retry previously erased. We adopt
[Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
and separate delivery summaries from individual attempt evidence. This supersedes
the custom signing protocol and latest-attempt storage in [ADR 0062](./0062-webhook-operator-tooling-replay-and-rotation-grace.md).
[Outpost's webhook destination](https://hookdeck.com/docs/outpost/destinations/webhook)
and [operator UI guide](https://hookdeck.com/docs/outpost/guides/building-your-own-ui)
informed the protocol and inspection workflow.

## Message identity and signing

The publisher creates a delivery ID before enqueueing. That ID travels in the
queue body, including through the dead-letter queue, and becomes `webhook-id`.
Automatic retries keep the ID and body. A manual replay creates a new delivery ID
and preserves the original event payload and `replayedFrom` provenance. Receivers
therefore deduplicate automatic retries while processing an intentional replay as
a new message.

`webhook-timestamp` contains Unix seconds for this dispatch. `webhook-signature`
contains space-separated `v1,<base64>` signatures. HMAC-SHA256 signs the UTF-8
bytes of `<webhook-id>.<webhook-timestamp>.<raw-body>`. Secrets contain a
`whsec_` prefix followed by a base64-encoded random 32-byte key. The prefix is
removed and the key is decoded before signing. There is no custom-protocol mode.
The current key signs first; the previous key also signs until the exclusive
24-hour grace deadline. A second rotation retires the oldest key immediately.

The receiver example uses the independent `standardwebhooks` verifier. It verifies
the original request text before parsing and enforces the verifier's timestamp
tolerance. Sender timestamps change on retries; message IDs do not.

## Attempt acceptance and ordering

An HTTP attempt observation is uniquely identified by delivery ID and queue
attempt ordinal. Each delivery has at most one terminal observation, independent
of the dead-letter queue's retry ordinal. HTTP dispatch and terminal bookkeeping are separate phases,
so moving a failed delivery to the dead-letter queue preserves its last HTTP
response without pretending another request occurred. Terminal observations have
no HTTP duration. A disabled or refused destination also records a terminal
observation when its endpoint still exists in the owning workspace.

The first observation for that identity wins. Duplicate queue processing can
still send a second HTTP request after a crash or during concurrent processing;
receivers must deduplicate by `webhook-id`. We do not claim exactly-once network
delivery. Stored evidence, summaries, counters, and audits are duplicate-safe.

D1 batches insert the observation, conditionally advance the summary, update the
failure streak, and record terminal or automatic-disable audits atomically. A
unique write token gates dependent statements within that batch. The summary
advances only from pending or retryable failure to a newer HTTP ordinal or to a
terminal outcome. Terminal bookkeeping preserves the highest recorded HTTP
attempt count even when the dead-letter queue reports a lower retry ordinal. A late observation remains inspectable but
cannot regress the summary, change the streak, or repeat a terminal audit.
Different deliveries affect an endpoint's streak in database commit order.

Automatic disable belongs to the same batch as the threshold-crossing attempt.
The worker sends best-effort warnings only for accepted results. Dead-letter
bookkeeping does not increment the streak again when HTTP attempts already
exist. Notifications are best-effort; audit and disable durability do not depend
on notification delivery.

## Evidence and retention

The drawer loads the ordered attempt timeline on demand through a workspace
read permission. REST exposes
`GET /workspaces/:slug/webhooks/deliveries/:deliveryId/attempts`; MCP exposes
`list_webhook_delivery_attempts`. Both require `webhook:list`. Request headers, response bodies, and failure reasons are
bounded again at persistence. The worker reads only a 2 KiB response prefix and
limits body-read time, including for a receiver that never closes its stream.
The complete event payload stays on the delivery summary for manual replay.

The existing daily worker schedule removes at most 100 delivery summaries older
than 30 days per pass. Attempt rows cascade with their delivery. This bounds each
cleanup invocation without another queue, cron, or storage service; a sustained
backlog can take several passes to drain. Replay provenance remains a plain ID
because the source can expire first. Seed uses the same retention and acceptance
rules as D1.
