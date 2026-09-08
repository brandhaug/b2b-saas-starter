# Transactional email delivery

Email Sending is optional. Without `EMAIL` and `CLOUDFLARE_EMAIL_FROM`, auth
emails render into the local log, including the links needed to complete the
flow. Delivery history calls this `logged`.

## Cloudflare setup

1. Enable Email Sending for the sender domain and complete its DNS verification.
   Configure the SPF, DKIM, and DMARC records Cloudflare specifies. Set
   `CLOUDFLARE_EMAIL_FROM` to an address on that domain.
2. Deploy the application infrastructure. The background Worker consumes the
   stage's `email-events` queue. Application Workers have no producer binding
   for this queue.
3. In Cloudflare Queues, select that queue, then Subscriptions, then Subscribe
   to events. Choose Email Sending and the configured sender domain. Subscribe
   to `message.delivered`, `message.deferred`, `message.bounced`,
   `message.failed`, `message.rejected`, and `message.complained`.
4. Keep each subscription in the same account and stage as its sending Worker.
   Restrict queue write credentials to operators who manage the subscription.
   Queue access is the authentication boundary; there is no public email-event
   webhook. The consumer additionally checks the event's sender and domain.
5. Monitor the `email-events-dlq` queue. After repairing a consumer or database
   failure, replay its events into the original queue using Cloudflare's queue
   tooling. Do not publish arbitrary payloads from application endpoints.

The Email Sending Workers API returns `messageId` for lifecycle correlation. The documented send input has no application message
ID field, so a lost response cannot reliably be correlated by recipient alone.
See the [Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/)
and [event subscriptions](https://developers.cloudflare.com/email-service/platform/event-subscriptions/).

## Outcomes and recovery

Provider acceptance prevents further application sends for the same message.
Cloudflare handles subsequent delivery delays. A delivered event means the
recipient mail server accepted the message; it says nothing about inbox placement
or reading. After 24 hours without a conclusive event, history shows delivery
unconfirmed. That alone never triggers a resend.

Permanent failures and suppression stop retries. Cloudflare owns suppression;
the application has no force-send or suppression-removal operation. Operators
resolve disputed suppression in Cloudflare. Users correct and verify addresses
through the normal account flow. Cloudflare automatically suppresses hard bounces
and complaints. See [suppression lists](https://developers.cloudflare.com/email-service/concepts/suppressions/).

Instant notification retries last at most 24 hours from notification creation.
Digest retries revisit the same 08:00 UTC window every 15 minutes for six hours.
The 14:00 hour settles expired attempts without sending them again.
Each attempt rechecks current preferences, permissions, unread state, and recipient
details. An unknown send outcome waits before a bounded retry. That policy can
produce a duplicate when Cloudflare accepted a send whose response was lost.

Account and security sends stay immediate. A user restarts verification or recovery
through the original auth endpoint to generate fresh credentials. No stored email
body, code, or link is replayed. Public recovery responses disclose no history.

## Evidence and operations

Records retain message and event identifiers, purpose, recipient, user/workspace
association, timestamps, attempt count, and sanitized outcomes. They contain no
rendered body, subject, OTP, secret link, raw SMTP response, or provider payload.
Ordinary evidence expires after 30 days; unresolved failures have a 90-day cap.
The daily background schedule prunes this evidence.

`starter.email.send.outcomes` counts application send outcomes by purpose and
status. The email-event consumer reports lifecycle changes and processing failures
through its metrics and canonical event. Existing `starter.requests` metrics expose
consumer errors. Configure [processing-error and dead-letter alerts](monitoring.md).
Recipient addresses and identifiers must not become metric attributes.

## Real delivery smoke test

Use a configured nonproduction stage and mailboxes controlled by the tester.

1. Invite a controlled address. Inspect invitation history as an owner, then as
   an ordinary member. Only the owner/admin should see that workspace history.
2. Request password recovery. Sign in and inspect personal history. A workspace
   administrator must not see another user's recovery history. Check sanitized
   global history with a System Admin session.
3. Verify a provider ID appears after acceptance and the subscription advances
   the record to delivered to recipient server. Inspect the actual mailbox
   independently; the application does not measure inbox placement.
4. Use Cloudflare's supported test facilities or an operator-controlled rejecting
   mailbox to exercise a hard bounce and temporary failure. Exercise suppression
   using a provider-suppressed test address. Do not generate unsolicited mail or
   complaints against real recipients.
5. Replay one recorded lifecycle event twice through the trusted queue. Confirm
   history does not regress and no additional email is sent. Replay a deferred
   event after delivery and confirm delivery remains terminal.
6. Confirm recovery resend generates a fresh working link, invitation resend is
   rate-limited, and suppressed/permanent failures offer an actionable warning.

A local test run cannot establish real provider delivery. Record the stage,
sanitized message IDs, observed outcomes, and date when performing this smoke test.
