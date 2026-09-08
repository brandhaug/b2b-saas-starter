# Queued notification email and daily digests

Notification preferences choose off, instant, or digest per kind. Stored preferences override code-owned defaults, avoiding a backfill for each new kind. Instant delivery uses its own queue with notification and recipient IDs; the consumer rereads visibility, unread state, address, and preferences before sending. Queue publication is best-effort because the notification feed is the durable user-facing record.

The daily digest covers the preceding 24 hours at 08:00 UTC. Repeated scheduled passes use the same window and recipient delivery identity to retry unresolved sends within six hours without resending accepted mail. Durable email delivery tracking governs attempts; a later day's digest is not a retry of the previous window.

Email rendering uses the recipient's locale and the shared dispatcher, including local log mode. Preference links require sign-in, so forwarding a message cannot change its recipient's settings. Separate queue and scheduled paths isolate email latency and failures from the mutation that created a notification.
