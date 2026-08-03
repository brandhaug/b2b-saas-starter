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
