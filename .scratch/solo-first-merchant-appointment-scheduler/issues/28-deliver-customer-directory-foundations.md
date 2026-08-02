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

### Resolution — 2026-08-02

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
typechecks and scoped lint/format checks. The workspace-wide suite still contains
unrelated pre-existing failures in Merchant Catalog/Booking Confirmation fixtures,
Merchant route loading, and parallel Miniflare address allocation.
