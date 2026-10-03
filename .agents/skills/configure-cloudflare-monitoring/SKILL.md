---
name: configure-cloudflare-monitoring
description: Configure or reconcile Cloudflare SQL alerts and shared Worker dashboards for a deployment, adapt monitoring to a scenario, and verify thresholds, missing data, and delivery. Use for monitoring setup or changes; use investigate-cloudflare for incident diagnosis.
---

# Configure Cloudflare monitoring

Use the existing events and policies in [monitoring](../../../docs/monitoring.md).
Read [operations](../../../docs/operations.md#operator-configuration) for ownership
and independent monitors, and [logger policy](../../../packages/logger/README.md)
before handling telemetry. Setup never requires duplicate application events.

1. Establish the requested scenario: initial setup, reconcile drift, add a signal,
   or verify a deployment. Identify the account, stage, deployed Worker names and
   versions, operator, and existing dashboard/rule IDs from the private operations
   record. Derive names from `stageResourceNames` in `infra/bindings.ts` and verify
   them against the deployment. Scope every chart and rule to that stage.
2. Read [setup](references/setup.md) to discover actual datasets and fields, choose
   supported declarative resources or the dashboard, and prepare the configuration.
   Reuse available access; Worker deployment permission does not prove telemetry
   query or alert-edit permission. A 403 is an access gap, not an empty dataset.
3. Reconcile only the requested resources by their recorded IDs. Present the
   concrete changes before applying them. Existing authorization for setup covers
   those changes; ask only for missing scope or authorization. Sending a test or
   enabling delivery requires an explicitly identified, authorized destination.
   Never infer recipients from Git, account profiles, or existing unrelated rules.
   Agent connections require their own explicit request.
4. Run the relevant [verification scenarios](references/verification.md). Report
   each result as local, live verified, blocked, or unsupported. Read back saved
   configuration, then repeat reconciliation and show that no duplicate resource
   or unnecessary change results. Provider acceptance alone does not prove delivery.
5. Record IDs, exact queries or chart settings, discovered field mappings, UTC
   windows, sanitized aggregates and remaining checks in the private operations
   record. Keep raw logs, credentials, recipient addresses and secret webhook URLs
   out of repository artifacts. If live access is missing, finish the configuration
   plan and local checks first, then request the exact account/stage, access route,
   or destination needed. Do not describe a prepared plan as deployed monitoring.

For a new signal, first locate its canonical event and owning capability. Apply
the same discovery, freshness, recovery, and rerun checks; change application
telemetry only when the requested scenario lacks evidence. For incident diagnosis,
use [investigate-cloudflare](../investigate-cloudflare/SKILL.md).
