# Define Production Release Gates

Type: grilling
Status: resolved
Blocked by: 08, 15, 16, 19, 20, 22

## Question

What named production-ingress journeys, Owner authorization and Merchant-isolation checks, concurrency and idempotency scenarios, Solo subscription and provider failure modes, notification and queue recovery evidence, accessibility targets, migration and rollback proofs, parity-ledger updates, dashboards, alerts, and runbooks must pass before beesolo is declared production-ready?

## Comments

### Resolution — 2026-08-02

beesolo uses two release boundaries. The **Core Production Gate** is non-waivable and must pass for one immutable release candidate before that candidate receives production traffic. Optional provider-backed capabilities use independent **Feature Activation Gates**: a failed or unavailable gate keeps that capability safely disabled without permitting partial activation or blocking a Core-ready release unless the capability has become launch-critical. Security, privacy, authorization, Merchant isolation, data integrity, migration, rollback, and recovery failures cannot be waived.

Every gate binds to the exact code, artifact, schema, required configuration, controlled-template, and policy revisions being promoted. Evidence from another candidate or undocumented manual judgment does not count. Material changes invalidate the affected evidence, and evidence older than seven days must be rerun before first production promotion.

#### Production ingress and Release Journeys

Every externally reachable HTTP route, provider callback, Queue consumer, and scheduled trigger is a **Production Ingress** with one owning surface or capability and at least one automated contract or Release Journey. An unowned or uncovered ingress blocks release. Browser automation covers named critical journeys rather than duplicating one browser test per route; machine-ingress contracts cover callbacks, queues, scheduled work, replay, and remaining routes.

The mandatory browser Release Journey families are:

1. **Discover and Enter a Published Shop** — localized Public Site through Public Booking Page.
2. **Start Solo and Publish** — Owner signup, trial, onboarding, Launch Test, and first publication.
3. **Book the Last Available Time Slot Exactly Once** — guest booking with a real contention loser and confirmation evidence.
4. **Manage an Appointment as the Customer** — capability-protected view, reschedule, cancellation, and expired or replayed link handling.
5. **Run the Daily Appointment Ledger** — Owner creation, edit, reschedule, cancellation, No Show, completion, and External Collection.
6. **Create and End an Appointment Series** — atomic materialization and cancellation of remaining Scheduled members.
7. **Change Availability Safely** — hours, exceptions, blocked time, and preservation of existing Appointments.
8. **Operate the Walk-in Queue** — admission through Appointment conversion or terminal departure.
9. **Fulfil a Waiting List Offer** — application, offer, expiry, conflict-safe booking, and replacement progression.
10. **Manage a Customer Record Safely** — lookup, update, merge or split boundary, ban, export, and Merchant isolation.
11. **Restrict and Recover a Solo Subscription** — failed billing, read-only restriction, public-booking effect, recovery, and cancellation.
12. **Inspect and Export Truthful Reports** — drill-down, CSV generation, empty and error states, privacy minimization, and isolation.
13. **Process a Privacy Request** — accountless intake through verification, review, Access, Correction or Erasure execution, and recovery evidence.
14. **Support a Merchant Without Authority Leakage** — operator authentication, permission checks, impersonation handoff, attribution, expiry, and revocation.
15. **Degrade Safely When a Required Dependency Fails** — email, billing, Queue, or storage failure produces the specified unavailable or retry state without false success.

Each is a journey family with explicit happy, negative, responsive, localization, and accessibility variants. No critical variant may be silently skipped.

#### Authorization and Merchant isolation

Every Merchant-scoped read, mutation, search, bulk operation, export, capability, queued action, and callback correlation runs a generated authorization matrix: no session rejects; another Merchant's valid Owner session returns the same non-disclosing result as an absent resource; the correct Owner is limited to the requested Merchant; stale, revoked, expired, or access-held authority rejects; Restricted Access preserves only its explicit read, export, and recovery permissions; and an Impersonated Merchant Session applies Owner authority only with System Operator provenance, expiry, and revocation.

Guessed identifiers, reused cursors, bulk inputs, CSV exports, queue payloads, and callbacks must not cross the Merchant boundary. Every denied mutation proves zero state change, outbox work, financial consequence, and customer notification. Cross-Merchant attempts create safe security evidence without revealing the other Merchant or its Customer data.

#### Concurrency and idempotency

The gate exercises production-shaped real-D1 behavior. Repeating the same idempotency key and payload returns the original result without another effect; changing the payload under that key rejects. Commands racing on one revision produce one winner and one explicit conflict. Two customers competing for the last Time Slot create exactly one Appointment. Hold expiry cannot race confirmation into a late result; reschedule and cancellation races preserve one valid outcome and correct Availability.

Appointment Series creation is all-or-nothing and retry-safe. External Collection retry creates one ledger entry. Duplicate, delayed, contradictory, and out-of-order billing evidence converges without regressing newer authority. Queue failure after commit and before acknowledgement redelivers safely; overlapping scheduled sweeps claim work once. Notification callbacks cannot duplicate consequences or Messaging Balance charges, and ambiguous submission remains `Submission Unknown` rather than being blindly retried. A stale Privacy Request Preflight cannot mutate changed source data. Every loser and replay proves there is no duplicate Appointment, notification, charge, ledger entry, audit transition, or outbox consequence.

#### Provider and dependency failure behavior

D1 failure makes mutations fail closed and reads explicitly unavailable rather than falsely empty. Queue publication failure after a domain commit leaves the committed result recoverable through the transactional outbox and scheduled sweep. Missing or disabled Transactional Email or billing configuration fails the Core Production Gate; missing required bindings or secrets fail deployment validation before traffic moves.

Known email misconfiguration pauses Merchant Activation and new public demand. Transient email failure does not undo a committed Appointment: Notification Intents retry durably and remain visibly pending or failed. Billing outages preserve access only through the authoritative local entitlement projection and defined trial or grace lifecycle; a single timeout neither grants indefinite access nor causes arbitrary restriction, and durable events plus provider API reconciliation settle contradictions.

Turnstile failure makes new abuse-sensitive public submissions fail closed while existing authorized views remain usable. Unqualified or unavailable WhatsApp or SMS keeps its Feature Activation Gate closed without silent routing. Observability-provider failure does not corrupt product behavior: durable operational evidence remains authoritative and missing telemetry raises a detectable incident. Runtime code never represents an unconfigured dependency as successful.

#### Notification and Queue recovery evidence

The candidate must pass staging fault injection. Evidence proves atomic domain and Notification Operation or outbox commit; no residue on pre-commit failure; scheduled recovery after commit-before-enqueue failure; semantic deduplication after commit-before-ack redelivery; safe retry after pre-commit worker failure; poison-message dead-lettering and corrected redrive; convergence of duplicate or out-of-order callbacks; explicit terminal email failure in source history, reporting, and Operations; and the Messaging Launch Gate's fallback, `Submission Unknown`, reservation release, and reconciliation rules.

Queue backlog, oldest-message age, dead letters, stuck claims, overdue reminders, and pending-notification age must be measurable and alertable. A documented recovery exercise restores processing without direct production-row editing or manual recreation of customer notifications. Evidence retains safe correlation IDs, times, transitions, attempts, and outcomes but no raw destination, body, secret, or provider payload.

#### Accessibility

Every complete process in the Public Site, Booking App, Merchant App, Operations App, Transactional Email, and HTML privacy or export artifact targets WCAG 2.2 Level AA. Release Journeys must work with keyboard only, 200% text zoom, 400% reflow, reduced motion, and high-contrast preferences. Representative desktop and mobile journeys require manual VoiceOver with Safari and NVDA with Firefox evidence.

Romanian and English language metadata, labels, errors, instructions, and status announcements must be correct. Keyboard traps, obscured focus, color-only meaning, inaccessible drag-only interaction, silent validation, and unrecoverable timeouts fail the gate. Automated accessibility scans run on every journey state but do not replace manual keyboard and assistive-technology evidence. Essential third-party checkout and authentication are part of the complete process. A Level A or AA failure in a launch-critical journey is non-waivable.

#### Migration, rollback, and restore

Migrations use forward-only expand and contract. Each succeeds from an empty database and the immediately supported production schema with production-shaped fixtures. A preflight checks incompatible rows, cardinalities, bindings, and Solo invariants before destructive transformation and aborts without change on failure. Expansion precedes dependent code, and both previous and candidate Workers operate safely through the compatibility window. Backfills are bounded, resumable, idempotent, observable, and concurrency-safe. Tightening and removal wait until the old reader or writer is retired.

Release evidence records pre/post counts, invariant results, duration, schema and candidate identities, and the restore point. Application rollback routes traffic to the compatible previous Worker; schema rollback is forbidden. Faulty data or schema is repaired with a reviewed compensating forward migration. Restore is last resort and must be rehearsed on a disposable production-shaped database. Traffic returns only after Privacy Action Ledger replay, artifact and capability invalidation, subscription and provider reconciliation, and safe queue drain or redrive. The gate exercises failed migration, application rollback, and point-in-time restore without undocumented database editing.

#### Parity evidence

The parity ledger becomes a release-evidence index. Every launch state is implemented, intentionally removed, or explicitly deferred. Implemented entries identify owner, Release Journey or lower-level evidence, locale, and responsive profile. Structural completeness remains mandatory but never stands in for behavioral proof. Solo absence assertions cover Team navigation, additional Providers, Provider choice, Team pricing, invitations, roles, and retired starter or developer surfaces.

Behavior changes update the ledger in the same change, generated documentation is regenerated, and the exact candidate has no launch entry left planned, placeholder, skipped, or evidenced only by screenshots. Intentional differences link to their governing decision and a regression assertion. The release report summarizes evidence by surface, journey, viewport, locale, and accessibility mode without a misleading aggregate percentage.

#### Operations dashboards

Production has seven environment- and candidate-filtered dashboard families: **Release Health**; **Booking Integrity**; **Authorization and Isolation**; **Solo Subscription**; **Notifications and Queues**; **Privacy Operations**; and **Migration and Data Recovery**. They expose deployment, traffic, latency, errors, booking and idempotency invariants, access enforcement, entitlement and reconciliation health, notification and queue recovery, privacy deadlines and execution, migration or restore state, and Privacy Action Ledger replay. They use aggregate or masked data, link through opaque evidence references, and never reveal raw Customer destinations, bodies, secrets, or cross-Merchant report data.

#### Alerts

**SEV-1** pages immediately on any authorization bypass, confirmed cross-Merchant disclosure or mutation, double booking, duplicate financial charge, corrupted migration, erased data becoming searchable or deliverable, unrecoverable committed-work loss, or broad authentication failure.

**SEV-2** pages on two consecutive critical-synthetic failures; at least 2% unexpected critical-ingress failures over five minutes with at least 25 attempts; any critical dead letter; outbox or Queue work older than five minutes; a required reminder more than five minutes overdue; at least 10% required-email terminal failures over fifteen minutes with at least 20 attempts; a failed required privacy notice; or five minutes of missing deployment-health evidence.

**SEV-3** is actionable during the operating day for subscription or messaging reconciliation older than one hour, Privacy Requests within 72 hours of deadline, sustained noncritical provider degradation, missed retention or artifact cleanup, overdue backfill, or durable drift without immediate harm.

Alerts name environment, candidate, surface, symptom, start time, and safe correlation reference; link one owned runbook and dashboard; deduplicate symptoms and declare recovery; and are staging-exercised through routing, acknowledgement, escalation, and recovery. Expected business conflicts do not count as errors. Threshold changes require reviewed post-launch evidence.

#### Runbooks

The required runbooks are **Failed Deployment and Traffic Rollback**; **Failed Migration, Compensating Migration, and Point-in-Time Restore**; **Public Booking or Merchant App Outage**; **Double Booking or Appointment Integrity Incident**; **Authorization Bypass or Merchant-Isolation Incident**; **Owner Authentication, Access Hold, and Account Recovery Incident**; **Solo Subscription Provider Outage and Entitlement Reconciliation**; **Transactional Email Failure and Notification Recovery**; **Queue Backlog, Poison Message, Dead Letter, and Redrive**; **Mobile Messaging Containment, Submission Unknown, and Financial Reconciliation**; **Privacy Request Deadline, Failed Execution, Erasure, and Restore-Replay Incident**; **Observability Failure and Missing-Telemetry Verification**; **Required Secret or Provider-Credential Rotation**; and **Turnstile Degradation or Public-Abuse Surge**.

Each states its trigger, severity, accountable role, permission, containment, diagnostic queries, executable recovery commands, rollback boundary, communication criteria, verification, evidence retention, and escalation. Staging exercises prove commands and links. No runbook authorizes undocumented production database editing.

#### Security, capacity, and recovery objectives

The security gate permits no known high or critical dependency vulnerability and checks lockfile integrity, secrets in source and artifacts, production cookies, session separation, CSRF, CORS, CSP, headers, trusted origins, caches, callback signatures and replay, rate limits, Turnstile, capability scope and expiry, injection, redirects, traversal, mass assignment, and error leakage. Production-shaped dynamic and abuse tests cover public ingress, auth, booking, privacy, exports, and operator handoffs. Medium findings need an owner, deadline, and containment; security, privacy, and isolation findings cannot be reclassified to evade the gate.

Initial performance targets are p95 below 500 ms and p99 below 1.5 seconds for reads, Availability p95 below 750 ms, D1 mutation p95 below one second, and booking confirmation p95 below two seconds excluding asynchronous delivery, with unexpected errors below 1%. The candidate must sustain 25-way contention for one slot, 100 concurrent booking sessions across Merchants for fifteen minutes, and recovery of 1,000 committed outbox items without semantic duplication and with oldest work below five minutes after processing resumes. Reporting exports are bounded and non-blocking. Tests include cold starts, both locales, mobile clients, and production-equivalent bindings. A regression over 20% from the previous accepted candidate requires investigation even if the absolute target passes.

The Core application RTO is 60 minutes. Public booking must restore or enter an explicit no-false-confirmation unavailable state within ten minutes. Acknowledged domain mutations and committed Notification Operations have zero RPO under ordinary deploy, rollback, Queue, or provider failure. Database disaster RPO is at most fifteen minutes followed by reconciliation. Privacy has zero tolerance for restored erased, quarantined, corrected, or held data becoming searchable, deliverable, or writable. Subscription authority must reconcile before lifting maintenance where evidence may be stale. A timed production-shaped restore exercise, not a provider claim, proves these objectives.

#### Release authority

One immutable **Release Readiness Record** is the sole promotion authority. It records commit and artifact digests, schema and restore point, configuration fingerprints without secrets, every gate result, Feature Activation states, manual accessibility and recovery attestations, provider qualification, legal and privacy approval, parity revision, dashboard and alert routing, runbook exercises, known non-gating issues, accountable approver, and promotion time. Automation determines gate state; an authorized human initiates promotion but cannot override a failed non-waivable gate.
