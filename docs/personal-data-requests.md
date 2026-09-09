# Personal-data requests

This is the operator runbook for requests from an identified person. It covers
the starter's technical behavior. It does not decide whether a deployment is a
controller, joint controller, or processor, or whether a request is legally
valid. The deploying organization appoints the request owner and legal contact
and records those decisions.

## Intake and triage

1. Record the received date and time, requester's contact channel, the request
   in their own words, the account or Workspace concerned, and the named
   operator. Keep this record in the operator's restricted request register,
   not in this repository. Do not paste the request, an export, credentials,
   or provider payloads into chat, tickets visible to a broad team, or source
   control.
2. Acknowledge the request and ask only for information needed to understand
   its scope. The request owner decides whether the organization is acting as
   controller, processor, or both for each record. If it is a processor, send
   the request to the controller and provide the technical assistance required
   by the contract. Do not answer a data subject in the controller's name
   without that authority.
3. Verify identity before disclosing or changing personal data. Prefer the
   authenticated account session and a recent-authentication check. For an
   email or other unauthenticated request, the request owner chooses a
   proportionate independent check and records what was checked, without
   collecting a new copy of identity documents unless the legal contact has
   approved it. Never accept a user ID supplied only in the request body as
   proof of identity.
4. Search the data inventory in [the security checklist](security-checklist.md)
   and identify shared records, configured providers, queues, backups, and
   downloaded copies. The legal contact decides the applicable right, lawful
   basis, exemptions, retention needs, and whether another person's rights
   limit disclosure.
5. Assign one owner for the response and one legal reviewer where the request
   is refused, narrowed, complex, or involves a shared record. Record the
   decision, scope, response date, completion evidence reference, and any
   unresolved provider or backup action in the restricted register.

Respond without undue delay and normally within one month of receipt. The
Commission describes identity confirmation where needed and reasons for a
refusal. The period can be extended by up to two further months for a complex
request, but the requester must be told about the extension and its reason
within the first month. Confirm the deadline and any local-law variation with
the legal contact. A refusal must explain the reason and how the requester can
complain to the supervisory authority or seek a judicial remedy. If only part
of the request is complete, send the completed part by the deadline and state
what remains, who owns it, and the next date or dependency.
See the [Commission guidance on individual requests](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/dealing-requests-individuals_en)
and the [EDPB FAQ on extensions](https://www.edpb.europa.eu/sme/find-practical-info/faq_en).

Record the calculated original due date. If an extension is needed, record the
decision date, reason, revised due date, and the date the notice was sent.

## Response paths

### Access

For a verified account holder, use the account page's personal-data export.
The server takes the identity from the current session, requires recent
authentication, records `auth.personal_data_exported`, and returns the JSON
only to that request. It does not create an R2 artifact or retain the archive
as a shared application record.

The archive contains the profile, account and notification preferences,
memberships, user-targeted notifications, session metadata, linked-provider
metadata, and passkey metadata. It excludes passwords, bearer-token material,
OAuth credentials, two-factor secrets, backup codes, and other users' data.
Workspace business records are shared records. Use the [Workspace Export
documentation](../apps/web/content/docs/governance/data-export.mdx) only when
the verified requester is entitled to that Workspace data.

Review the generated scope before sending anything outside the authenticated
session. If the request covers provider-held copies, mailboxes, logs, or a
download the person already made, the operator must coordinate with the
relevant provider or controller. The archive is also not a complete dump of
every D1 record. Audit events, invitations, billing evidence, webhook history,
and other shared records may need a separate scoped review. Include the
applicable purposes, recipients, retention information, and safeguards from
the deployment's notice and legal assessment. If the application cannot
retrieve or safely redact an in-scope record, escalate it and do not promise
that the download alone fulfils access.

### Correction

There is no general operator correction workflow or correction endpoint. The
request owner must decide whether the person can correct the relevant field in
an existing account or Workspace setting, whether an authorized Workspace
owner must do it, or whether the controller must use a provider's procedure.
Apply only the approved change through the owning capability, then verify the
new value and record the completion reference. Do not edit D1 rows directly.
If a field has no supported edit path, escalate to the legal and product owner;
do not promise correction that the application cannot perform.

### Deletion and erasure

The authenticated account page supports self-service account deletion after
password re-authentication. The delete endpoint verifies the password before
the teardown hook runs. It removes the account's personal notifications and
email-delivery records, scrubs identifying details from retained audit metadata,
revokes sessions, and records an actorless `account.deleted` event.

For each Workspace, the account-deletion rule removes the membership when
other owners remain. If the account is the only member, it deletes the
Workspace with the account. It blocks before changing anything when the
account is the sole owner among other members, or the sole member of a
suspended Workspace. Follow [account deletion](../apps/web/content/docs/governance/account-deletion.mdx)
to transfer ownership or resolve suspension before retrying.

Erasure does not remove shared Workspace records needed by other members, the
minimal retained audit metadata, or independent backups immediately. The
retention policy explains those exceptions and the [backup recovery procedure](backup-recovery.md)
replays deletion evidence after a restore. Operators must separately request
deletion or suppression from enabled identity, email, telemetry, AI, billing,
webhook, and storage providers where the contract or law requires it.

Account deletion crosses Better Auth hooks, Workspace teardown, D1 audit, and
provider dispatch. A failed response, timeout, or missing `account.deleted`
evidence is indeterminate. Inspect the actual account and Workspace state,
available audit and independent security evidence, queues and provider state.
Reconcile before retrying, and record an incomplete outcome and next action.
Do not blindly retry or treat the audit event alone as proof of success. An
unavailable `account.deleted` event does not prove that the account still
exists. Use [account deletion](../apps/web/content/docs/governance/account-deletion.mdx)
and the [recovery procedure](backup-recovery.md) for state and restore checks.

### Restriction

The starter has no general "restrict processing" flag, case queue, or operator
hold that covers all capabilities and providers. Notification preferences can
stop eligible notification email, and marking a notification read prevents
its email fan-out, but those controls are not a legal processing restriction.
The request owner must define the restricted scope, stop the affected manual or
scheduled processing where operators control it, and obtain the legal/product
decision for each provider and queue. Record what remains necessary, such as
security, legal, or recovery evidence, and escalate any unsupported hold rather
than claiming the request is complete.

### Objection

There is no general objection workflow or purpose-level suppression control.
Notification settings cover notification channels only. The legal contact
must assess the purpose and lawful basis, decide whether the objection is
accepted or what exception applies, and give the operator an exact control
plan. For direct marketing, apply the legal contact's suppression decision and
do not assume a balancing override. Until that decision, do not delete shared
records or disable security processing by assumption. Escalate a purpose that
the deployment cannot suppress or explain.

The [EDPB rights guidance](https://www.edpb.europa.eu/sme/be-compliant/respect-individuals-rights_en)
is useful for the scope of access, correction, erasure, restriction, and
objection, and for the processor's duty to help the controller. It does not
turn an unsupported application control into a supported one.

## Providers, shared records, and recovery

The deploying organization decides controller and processor roles per purpose
and records those decisions with contracts, locations, recipients, lawful
bases, and transfer arrangements. A provider may be a separate controller,
the organization's processor, or outside the organization's instruction. Ask
the legal contact before forwarding a request to a provider.

Treat these as separate work items:

- Cloudflare D1, Queues, R2, Workers logs, configured monitoring sinks, email
  transport, Stripe, webhooks, OAuth providers, and an enabled AI provider may
  hold copies or metadata outside the application export.
- A Workspace membership, audit event, notification broadcast, billing record,
  webhook history, or delivered message can concern several people. Remove or
  redact the requester's personal part only where the owning capability and
  legal decision allow it. Preserve another person's rights and records that
  have an approved retention exception.
- R2 Workspace Export artifacts expire after seven days and signed links after
  at most fifteen minutes. A recipient's downloaded copy is outside that
  lifecycle and needs separate instructions.
- The independent encrypted backup keeps 30 daily recovery points. Keep the
  minimal deletion and credential-revocation evidence until every restorable
  point and the additional seven-day safety period expire. If a restore occurs,
  close the shared system, apply the evidence bundle, invalidate restored
  sessions and grants, reconcile providers and queues, and complete the
  [reopening checklist](operations.md#verify-and-reopen).

Routine retention is not a request handler. The [retention operator procedure](retention.md)
controls bounded cleanup and its approval; it does not authorize an operator
to bypass ownership checks or erase provider copies.

## Minimal request record

Keep only what an operator needs to show handling:

```text
receivedAt, requestChannel, subjectReference, requestType, scope,
identityCheck, requestOwner, decisionAt, decidedBy, legalDecision,
originalDueDate, extensionDecisionAt, extensionReason, extensionDueDate,
extensionNoticeAt, responseSentAt, completedAt, completionReference,
providerOrBackupFollowUps
```

Use a stable internal subject reference rather than an export or raw payload.
Restrict the register under the operator access policy and apply the
deployment's approved retention period for request records. The [retention
policy](retention.md#policy-matrix) covers application records and recovery
evidence, but does not set a legal period for the request register. A completion
reference should point to restricted evidence, such as an export event,
deletion result, provider confirmation, or recovery replay record. It must not
be the personal data itself.

## Synthetic walkthrough

Assume a fictional verified requester is a member of an isolated synthetic
Workspace that also has another owner. The person submits an access request
and asks for deletion in the same message.

The operator records receipt and asks the legal contact to confirm that the
deployment is the controller for the account records. The requester signs in
to `/account`, completes the recent-authentication check, and uses the personal
export control. The returned JSON contains the requester's profile,
preferences, membership, addressed notifications, session metadata,
linked-account metadata, and passkey metadata. It contains no password, token,
OAuth secret, or other member's notification. The operator confirms delivery
through the approved restricted channel and records the export audit event as
the completion reference. The generated JSON is not retained by the
application.

The requester reviews the deletion plan and confirms deletion with their
password. Because another owner remains, the account leaves the Workspace and
its shared business records remain. The account's personal notifications and
email-delivery rows are removed, identifying details in retained audit events
are scrubbed, and sessions are revoked. The minimal `account.deleted` audit
record remains under the audit-retention period. If the requester had instead
been the sole owner with other members, deletion would have stopped before any
teardown and the owner transfer would have been a required legal and
operational decision. A backup created before the deletion can still contain
the old rows until its normal expiry; the recovery evidence must replay the
deletion if that backup is restored.

That outcome is recorded only after the operator verifies the resulting state
and available evidence. If the response fails or times out, the operator treats
the deletion as indeterminate, inspects the account, Workspace, audit,
provider, queue, and independent-evidence state, and records any incomplete
follow-up before deciding whether a retry is safe.

This walkthrough does not demonstrate correction, restriction, objection, or
provider erasure. The current application has no dedicated controls for those
actions, so each remains an operator and legal escalation.
