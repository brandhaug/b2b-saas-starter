# Operational Messaging Jobs

This module owns provider-neutral reconciliation and retention jobs. Jobs are leased,
bounded, idempotent, and safe to retry after any partial failure. They may append
cases or erase expired protected material, but never rewrite Provider Evidence,
financial ledger entries, or audit history.

Ambiguous submission closes after seven days without a Merchant charge. Retention
operates at the narrow resource scope represented by each tombstone; a Shop filter
must never affect another Merchant's records.
