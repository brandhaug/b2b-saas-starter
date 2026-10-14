# Transactional email delivery

Email Sending is optional. Without `EMAIL` and `CLOUDFLARE_EMAIL_FROM`, auth
emails render into the local log, including the links needed to complete the
flow. Delivery history calls this `logged`.

## Cloudflare setup

1. Configure `production.emailSending` in [deployment.config.ts](../deployment.config.ts):

   ```ts
   emailSending: {
     zoneId: '<32-character-zone-id>',
     from: 'notifications@mail.your-domain.net'
   }
   ```

   The zone must already be on Cloudflare, and the account must be entitled to
   Email Sending. Use a sending subdomain. Bootstrap publishes the exact From
   address as `CLOUDFLARE_EMAIL_FROM`; the domain is derived from that address.

2. Apply `pnpm run bootstrap:deploy`, then deploy the application infrastructure
   through CI. This creates the production `email-events` queue and its background
   consumer. Application Workers have no producer binding for this queue.
3. From the persistent operator checkout, supply an operator Cloudflare credential
   and `CLOUDFLARE_ACCOUNT_ID`, then run:

   ```bash
   pnpm run bootstrap:email:plan
   pnpm run bootstrap:email
   ```

   [alchemy.email.ts](../alchemy.email.ts) uses separate local state. It discovers
   the existing production queue by exact name, provisions the sender through
   `Cloudflare.Email.SendingSubdomain`, disables stored message-content previews,
   and creates the domain-scoped lifecycle subscription. Alchemy/Cloudflare manage
   the sender's DKIM/SPF/return-path records and wait for sender activation; domain
   ownership, account entitlement, and any organization-specific DMARC policy
   remain operator inputs.

4. The email operator token needs **Email Sending Write** and **Queues Write** on
   the deployment account, plus **Zone Read** on the configured sender zone only.
   These grants belong to the operator, not the routine CI token. The sender API's
   reference omits permission metadata; the Email Sending Write group is taken
   from the pinned provider catalogue and still needs live authorization verification.

   The local provider covers the Email Sending source variant missing from pinned
   Alchemy's generic subscription resource. It subscribes to `message.delivered`,
   `message.deferred`, `message.bounced`, `message.failed`, `message.rejected`, and
   `message.complained`. It rejects preview stages, mismatched accounts, foreign
   queues/zones, and conflicting sender subscriptions. Queue access is the
   authentication boundary; there is no public email-event webhook. The consumer
   additionally checks the event's sender and domain.

5. Reapply the email stack to reconcile subscription events and message-preview
   settings. The commands enable Alchemy drift detection and force reconciliation;
   a dry-run inspects remote state without applying repairs, while deploy presents
   detected repairs before applying. Preserve its `.alchemy/state/b2b-saas-starter-email/prod/` directory.
   If a manual subscription already owns this sender, inspect and migrate that
   subscription before applying; the provider refuses to overwrite another name
   or queue. Removing the privacy resource never re-enables message previews.
   The native sender provider also requires explicit adoption for a sender created
   outside this state, including a create that succeeded before state was saved.
   Inspect the configured zone, sender name and existing DNS records, then use:

   ```bash
   pnpm run bootstrap:email:plan --adopt
   pnpm run bootstrap:email --adopt
   ```

   Adoption transfers the configured sender to this stack's lifecycle, including
   deletion on destroy. The event queue is only discovered and is never adopted.
   A conflicting subscription name or queue is still rejected; `--adopt` does not
   bypass those ownership checks. Subsequent runs can omit `--adopt`.

6. Monitor the `email-events` queue backlog and the `queue_exhausted` signal.
   The queue has no dead-letter queue: a delivery event that exhausts its
   twelve attempts expires on the primary queue, so repair the consumer or
   database before the retry window closes. Do not publish arbitrary payloads
   from application endpoints.

Local contract verification: `vp test run scripts/email-sending.test.ts
scripts/email-settings.test.ts`. These tests use controlled HTTP responses. Live
acceptance requires the operator apply followed by the delivery smoke test below;
local tests alone do not establish provider authorization or actual delivery.

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
