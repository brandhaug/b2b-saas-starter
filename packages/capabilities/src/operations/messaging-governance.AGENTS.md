# Operations Messaging Governance

This module owns System Operator commands for Messaging Reconciliation Cases,
Messaging Incidents, containment, and guarded recovery. Every command authorizes the
current Operator Session, rejects Merchant impersonation, requires the narrowest
effective scope and a substantive reason, and commits its append-only history and
governance audit in the same D1 batch as the state change.

Global re-enable and compromised-credential recovery require two distinct current
System Operators plus reconciliation, health-probe, and residual-risk references.
Commands never edit Provider Evidence or financial ledger entries.
