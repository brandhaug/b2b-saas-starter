# Operational health

Operator-only global reads. Do not expose the snapshot through Workspace APIs.
Billing alerts consume persisted unresolved time; repaired drift is healthy.
Email transport failures before acceptance can indicate an outage; recipient
bounces and suppression must remain diagnostics.

The background minute schedule publishes zero as well as nonzero measurements
in `operations.snapshot` logs. Failed snapshots produce error events. Missing
snapshots require an external heartbeat monitor; Issues cannot detect silence. A quiet consumer does not prove its provider queue is
empty: the external queue monitor is required for stalled consumers.
