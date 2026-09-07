# Email delivery

## Purpose & Scope

Owns send claims and sanitized delivery evidence across auth, invitations and notifications. Cloudflare owns address suppression and retries after acceptance. Claims and provider events are operational evidence; they must not trigger user-notification fanout or recursive delivery attempts.

## Entry Points & Contracts

[The contract](email-delivery.ts) separates trusted worker writes from scoped reads. Caller guards authorize self-history and System Admin history. Invitation reads require `WorkspaceContext` plus an upstream invitation permission check. Resolving a user at send time fixes the history association; provider events must never discover or change that association.

## Patterns & Pitfalls

- Keep transport calls outside persistence. A claim token fences the attempt; the persisted accepted marker forbids future submission even when no delivery event arrives.
- An interrupted attempt can be retried after its lease only for notifications/digests within the original creation window. Consumers must recheck relevance, permissions and preferences before claiming.
- Missing provider evidence is not proof of failure. An unmatched event may race the acceptance write; the trusted consumer retries it briefly.
- Auth recovery uses the auth provider's fresh-credential flow. Retained records must never include rendered bodies, secret links, OTPs or raw provider payloads.
- Changes to terminal ordering or retention belong in the shared Seed/Live contract cases. Retention expiry measures original creation time, so repeated events cannot keep evidence indefinitely.
