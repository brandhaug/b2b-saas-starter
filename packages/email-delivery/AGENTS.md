# Email delivery

Owns send claims and sanitized delivery evidence across auth, invitations and notifications. Cloudflare owns address suppression and retries after acceptance. Claims and provider events are operational evidence; they must not trigger user-notification fanout or recursive delivery attempts.

## Contracts

[The contract](src/email-delivery.ts) separates trusted worker writes from identity-keyed reads. Caller guards authorize self-history and System Admin history. Invitation reads accept an explicit workspace identity; the capabilities package wraps them with `WorkspaceContext` plus an upstream invitation permission check. Resolving a user at send time fixes the history association; provider events must never discover or change that association.

## Pitfalls

- Keep transport calls outside persistence. Claim tokens fence failed outcomes. A late accepted receipt survives lease renewal; the persisted accepted marker forbids future submission even when no delivery event arrives.
- `trackedAttempt` owns claim, send-outcome persistence and metrics; transport adapters supply an effect producing sanitized outcomes and classify their own failures.
- An interrupted attempt can be retried after its lease only for notifications/digests within the original creation window. Consumers must recheck relevance, permissions and preferences before claiming.
- Missing provider evidence is not proof of failure. An unmatched event may race the acceptance write; the trusted consumer retries it briefly.
- Auth recovery uses the auth provider's fresh-credential flow. Retained records must never include rendered bodies, secret links, OTPs or raw provider payloads.
- Changes to terminal ordering or retention belong in the shared Seed/Live contract cases. Retention expiry measures original creation time, so repeated events cannot keep evidence indefinitely.
- A complaint can strengthen an existing failure without changing its status. Reordered weaker failure evidence must not erase it. Retention drains oldest-first 250-row pages in one invocation until each category is clear or its row budget is spent; a single-page cap strands expired evidence.
