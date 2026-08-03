# Deliver Merchant Reporting and Exports

Type: task
Status:
Blocked by: 31, 32, 34, 35

## Question

Deliver Owner-only operational reporting and privacy-minimal exports across Appointment, External Collection, Walk-in, Waiting List, and Notification facts. Use Shop Reporting Timezone, explicit service and activity periods, consistent generated-at reads, settled status and cohort denominators, truthful utilization and conversion, separate unverified collection facts, safe drill-downs, one CSV per primary fact, twenty-four-hour artifacts, audit and cleanup, and explicit empty, invalid, unavailable, pending, and export-failure states without revenue claims, stale aggregates, or cross-Merchant disclosure.

## Acceptance criteria

- [ ] Reports and exports apply the settled Shop-local/DST definitions and one consistent source-read boundary with visible generated-at metadata.
- [ ] Drill-downs and CSVs expose only approved fields, stable opaque join identifiers, UTC and local timestamps, explicit EUR formatting, and no prohibited customer or provider data.
- [ ] Empty is distinct from unavailable or partial; pending notification evidence is not failed, and failed export creates no artifact.
- [ ] Generated exports expire after twenty-four hours, source privacy changes affect regenerated output, and Restricted Access preserves Owner read/export authority.
