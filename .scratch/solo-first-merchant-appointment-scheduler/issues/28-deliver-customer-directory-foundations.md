# Deliver Customer Directory Foundations

Type: task
Status: resolved
Blocked by: 25

## Question

Deliver the Merchant-scoped Customer Directory vertical slice used by booking and operations: conservative exact-contact matching, Customer Records and observations, preferred and disputed destinations, consent evidence, private Merchant Notes, bans with non-disclosing public enforcement, duplicate suggestions, reasoned merge and split with provenance, search, import, privacy-minimal directory export, retention behavior, and Appointment association without rewriting immutable snapshots or creating Customer Accounts.

## Acceptance criteria

- [x] Public confirmation and Merchant Appointment creation can atomically match or create one Merchant-scoped Customer Record without name-only or cross-Merchant merging.
- [x] Owner search, edit, notes, bans, merge, split, import, and export operate through revisioned capabilities with attributed history and safe conflict recovery.
- [x] Bans and matching failures have generic public responses and create no cross-Merchant or private-reason disclosure.
- [x] Existing Appointment snapshots remain immutable through directory edits, merges, splits, corrections, and retention actions.

## Comments

### Implementation checkpoint — 2026-08-02

Added a dedicated Customer Directory capability with deterministic and Live D1
adapters. Exact normalized email or phone matching is conservative and Merchant-local;
name-only, ambiguous, and conflicting observations create separate records with
possible-duplicate suggestions. The aggregate owns preferred and disputed contacts,
destination-specific consent evidence, private attributed notes, expiring bans,
archive/restore, import preview and idempotent commit, minimized export, and retention
erasure.

All Owner mutations use expected revisions and idempotency keys and append attributed
history. Merge retains observations, contacts, notes, consent destinations, and the
strictest active ban; split moves selected observation provenance into a new record.
Public ban enforcement returns only a generic unavailable result, while every read and
match remains Merchant-scoped. Appointment associations are observations by opaque
Appointment ID; Appointment Customer Details snapshots are never stored in or mutated
through the directory capability.

Focused deterministic and real-D1 contracts pass, along with capabilities and database
typechecks and scoped lint/format checks. Review found that the first adapter does not
yet participate in the Appointment transaction; import provenance, historical-contact
edits, strictest-ban merge selection, merge/split idempotency, split assignment,
retention guards, and asynchronous encrypted export also remain incomplete. The
workspace-wide suite additionally contains unrelated pre-existing failures in Merchant
Catalog/Booking Confirmation fixtures, Merchant route loading, and parallel Miniflare
address allocation.

### Review checkpoint — 2026-08-03

Replaced the cross-Merchant startup cache with lazy Merchant-scoped relational reads and
transactional projection writes. Public confirmation now prepares Customer Record,
contact, observation, duplicate-suggestion, and Appointment association statements and
commits them in the same D1 batch as each Appointment; the same seam accepts
`merchant_created` origin for Merchant Appointment commands. Shared or conflicting
destinations remain separate possible duplicates, while one unique non-conflicting
match may add a historical contact. Active bans fail through the existing generic
public conflict response without exposing the private reason.

Import observations no longer fabricate Appointment IDs. Preferred-detail edits retain
superseded contact history; matching observations advance revisions and history;
merge/split replay is idempotent; merge selects the longest or indefinite active ban;
and retention accepts protected record IDs derived from future Appointments, Queue
activity, or holds. Focused deterministic and Live D1 contracts cover atomic
association, immutable Appointment snapshots, generic ban enforcement, Merchant
isolation, stale recovery, and merge/split provenance.

Final review separated this foundation from its downstream consumers. The exported
association builder supports `public_booking`, `merchant_created`, and
`record_completed` and returns statements for the caller's atomic Appointment batch;
issue 31 owns the not-yet-built Merchant command surfaces. Merge and split now move
relational observations and Appointment associations and persist immutable attributed
history. This ticket provides privacy-minimal export data and retention protection
inputs; issue 36 owns encrypted asynchronous artifacts and audit/cleanup, while issue
37 owns verified erasure, suppression fingerprints, holds, and snapshot anonymization.

Post-implementation review fixes now separate the reusable directory domain engine
from its Seed test layer, preserve relational merge targets and duplicate suggestions,
exclude merged records from Appointment matching, and surface invalid edits through
the typed Effect error channel. D1 rejects stale aggregate revisions inside the same
batch, and deterministic contact-derived identities make concurrent and
multi-Appointment preparation converge on one Merchant-scoped Customer Record.
Import history carries the requesting actor. Live regression coverage proves
same-pre-batch convergence and merge/split association movement.

### Reopened — 2026-08-03

Review found that the authenticated Merchant `/customers` route and Appointment
composer still consume the legacy Appointment-derived `booking.CustomerDirectory`
projection. That surface describes one entry per Appointment, keys rows by Appointment,
and does not expose the durable Customer Record operations claimed above. Reopened to
replace those consumers with the Merchant-scoped Customer Directory capability and to
prove the route and composer behavior through their public server/UI seams.

### Fresh review — 2026-08-03

Reopened implementation work after a new standards/spec review found missing
database-enforced Merchant parity, collision-prone contact-derived record IDs,
untyped `appointment_observed` history, migration/schema index drift, and incomplete
Owner controls around merge/split, historical search, Merchant-created ban/archive
policy, and export attribution. Capability and atomic-association integrity are the
first repair slice; the legacy Merchant `/customers` and Appointment composer
consumers remain part of this claimed ticket.

### Final resolution — 2026-08-03

Replaced the Merchant `/customers` route and Appointment composer client picker with
authenticated reads of durable Merchant-scoped Customer Records keyed by stable record
ID. Removed the Merchant App's legacy Appointment-derived directory request path. The
directory workspace now supports revisioned preferred-detail and historical-contact
edits, attributed private notes and history, destination-specific consent evidence,
private bans, evidence-based duplicate merge, provenance-aware split, archive/restore,
quoted CSV preview/import, and privacy-minimal export through the Effect capability and
Live D1 layer.

Mutation failures reload the authoritative directory for safe conflict recovery. Merge
and split expose explicit preferred-detail, contact, note, consent, and observation
assignments; split moves selected destinations instead of duplicating active matching
evidence. Import keeps its reviewed rows frozen while refreshing authoritative revisions
before a retry. Export remains a minimized data-producing capability; issue 36 owns the
encrypted asynchronous artifact, attribution, delivery, expiry, and cleanup workflow.

Focused Merchant tests cover the authenticated request boundary, durable composer
selection, directory operations, quoted CSV import, and merge/split conflict recovery.
Focused deterministic and Live D1 contracts cover idempotent Appointment association,
explicit archive/ban policy, Merchant-parity insert/update guards, and immutable
Appointment provenance. Issue 31 continues to own the actual Merchant Appointment command
submission; this ticket supplies its durable `CustomerRecord.id` consumer and atomic
`merchant_created` association seam without rewriting Appointment snapshots.

The final two-axis review passes the issue specification with no remaining findings and
finds no hard repository-standard violations. It retains one non-blocking architecture
smell for follow-up: the Live adapter still reconciles overlapping legacy JSON state and
normalized relational Customer Record projections; removing that transitional dual
authority is a future deepening change, not a correctness blocker for this slice.

### Final blocker fixes — 2026-08-03

The final review found and closed two attribution/error-channel gaps. The Merchant
Customer Directory runner now reports a missing D1 binding as typed
`CapabilityUnavailable` instead of throwing a plain error. Non-public Appointment
association preparation now requires the effective Merchant Member actor and accepts
the real impersonating Operator as provenance; both persist in Customer Directory
history through the additive `impersonated_by` column. Public booking remains attributed
to `public-customer`.

Focused request-runner and Live D1 association tests pass, and Merchant, capabilities,
and database package typechecks pass. A repeated standards/spec review found no remaining
issue-28 blocker. The workspace-wide check remains stopped by unrelated concurrent
Merchant Catalog type errors.

### Final zero-findings review — 2026-08-03

Closed the last consent and deployment-readiness findings. Consent evidence now accepts
only an active owned destination, normalizes both operational and marketing phone
destinations, requires nonblank wording and source attribution, preserves the evidence
purpose during withdrawal, and permits withdrawal of historical evidence after a contact
is disputed. The Merchant workspace displays every destination-specific evidence item and
offers withdrawal against that exact purpose and destination. Booking and Web local/runtime
environments now provide and validate the dedicated Customer Directory fingerprint key.

Focused Customer Directory contracts pass (23/23), Merchant Customer Directory UI tests
pass (6/6), Booking readiness tests pass (7/7), and capabilities, Merchant, Booking, and Web
typechecks pass. Fresh independent Standards and Spec reviews of the completed issue diff
both explicitly reported zero findings. The issue remains resolved.
