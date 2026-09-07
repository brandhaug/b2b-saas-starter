# Operational health

Operator-only global reads. Do not expose the snapshot through Workspace APIs.
Billing alerts consume persisted unresolved time; repaired drift is healthy.
Email transport failures before acceptance can indicate an outage; recipient
bounces and suppression must remain diagnostics.

The background minute schedule publishes zero as well as nonzero gauges so
Sentry can resolve incidents. A failed or missed snapshot must remain visible
through its cron monitor. A quiet consumer does not prove its provider queue is
empty: the external queue monitor is required for stalled consumers.
