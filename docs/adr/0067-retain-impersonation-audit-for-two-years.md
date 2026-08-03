# Retain impersonation audit data for two years

Impersonation Audit Trail data is retained for two years and survives Merchant, Merchant Member, or System Operator deactivation and deletion through stable identifiers with display data redacted as necessary. Impersonation Reasons and support references remain access-controlled audit metadata and never enter ordinary application, request, or observability logs. This requires impersonation events to avoid the current Merchant cascade-deletion behavior used by general audit rows.
