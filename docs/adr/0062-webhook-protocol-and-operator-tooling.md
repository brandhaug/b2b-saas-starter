# Webhook protocol and operator evidence

Outbound delivery uses Standard Webhooks so receivers can use an independent verifier. HMAC-SHA256 signs `<webhook-id>.<webhook-timestamp>.<raw-body>` with a decoded 32-byte key; headers carry the stable message ID, dispatch timestamp, and versioned signatures. Automatic retries retain message ID and payload. Manual replay creates a new delivery with the original payload and a plain `replayedFrom` ID, preserving evidence even when the source later expires.

Fan-out persists pending deliveries before enqueueing, as test sends and replays do. Queue execution requires a persisted delivery matching the endpoint and its current workspace. The stored event and payload supply dispatch, terminal audit, and dead-letter notification contents; queue fields cannot replace them. Unknown or mismatched delivery IDs produce no terminal evidence or replayable row. Endpoint availability, resource selection, and workspace suspension are checked at dispatch. Requester authorization remains at scheduling, so background execution does not reconstruct a session or require the requester to remain a member.

Rotation moves the current key into a previous-key slot. The sender signs with both until the exclusive twenty-four-hour deadline; another rotation immediately retires the oldest key. This permits receiver configuration changes without an unsigned cutover window.

Immutable attempt observations are separate from the delivery summary. Delivery ID and queue ordinal identify HTTP attempts; terminal bookkeeping has its own identity and preserves the last HTTP evidence. First observation wins. Late attempts remain inspectable but cannot regress the summary, repeat terminal audits, or change the failure streak. Network sends can still duplicate after crashes, so receivers must deduplicate by message ID.

D1 batches observation insertion, conditional summary advancement, streak changes, and threshold-triggered audit/disable effects. Automatic disable is durable even if warning delivery fails. Dead-letter bookkeeping does not count an existing HTTP failure twice. Endpoint failures take effect in database commit order.

Response evidence is size- and time-bounded, including a 2 KiB response prefix; complete event payloads remain available for replay. Authorized operators can inspect attempts, test, replay, update, delete, and rotate endpoints. Explicit enqueue failures must remain visible even when a pending row already committed.

Daily cleanup removes at most 100 deliveries older than thirty days per pass; attempts cascade with them. This bounds scheduled work, though a backlog can require several passes. Seed follows the same acceptance, ordering, rotation, and retention rules as Live.
