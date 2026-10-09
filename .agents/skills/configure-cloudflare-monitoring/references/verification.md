# Verify setup and changes

Run the cases relevant to the changed monitor. For first setup, cover all rows.
Use an isolated deployed stage and its existing failure/drill mechanisms. Define
fault duration, cleanup and the authorized test destination before injecting a
failure. Query fixtures or local tests establish logic only; a provider preview
does not prove scheduled evaluation or notification delivery.

| Scenario                                                     | Required result                                                                                                                                                                                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repeat setup with identical desired settings                 | Same dashboard, chart and rule IDs; no duplicate resources or writes on the second pass                                                                                                                                                                      |
| One owned threshold/chart drifts                             | Correct only the owned difference; preserve unrelated rules/charts and destination settings outside the request                                                                                                                                              |
| Missing recorded ID or duplicate name                        | Re-discover before creating; ambiguous ownership blocks mutation                                                                                                                                                                                             |
| Unavailable query access, missing field, sampled-only totals | Record the specific gap; do not create a guessed query or mark a zero result healthy                                                                                                                                                                         |
| Shared dashboard scope                                       | All three Workers appear under their real names; another stage's traffic does not enter counts; ratio totals survive navigation/filter changes                                                                                                               |
| Native invocation accounting                                 | One invocation contributes once despite multiple log rows; maintenance/readiness rejections and a failed invocation without a response contribute correctly                                                                                                  |
| Five-minute HTTP gate                                        | 19 requests with errors do not open the ratio rule; 1/20 errors does not open; 2/20 does. Verify web and API separately.                                                                                                                                     |
| HTTP recovery                                                | A subsequent complete window at/below threshold, or positive traffic below the denominator gate with telemetry present, recovers. A completely empty window stays unknown.                                                                                   |
| Snapshot ordering                                            | An older nonzero snapshot followed by a fresh zero clears the value rule. A delayed older snapshot cannot override a newer one. Missing/null/malformed fields cannot become zero.                                                                            |
| Snapshot absence                                             | After a known healthy snapshot, stop the isolated source beyond two minutes and through at least two evaluation cycles. Repeat with a scope that has never produced rows. Freshness becomes unknown/alerting in both; value incidents cannot silently clear. |
| SQL evaluation failure                                       | Permission/query failure, timeout or unavailable dataset is visible as unknown/failed monitoring, not healthy. Verify independent watchdog catches lack of successful evaluation.                                                                            |
| Operational failures                                         | Exercise each canonical signal/threshold. Exhausted work and evidence gaps require recorded disposition; an unrelated success or aged-out window does not repair them.                                                                                       |
| Scheduled work                                               | Exercise failed run, omitted expected run, and start without completion past the slug's limit. Only that monitor's fresh successful run recovers.                                                                                                            |
| Delivery and deduplication                                   | A condition opens once at the named destination; recovery reaches it with UTC timestamps and matching environment/service/monitor identity. Repeat notifications follow configured policy.                                                                   |
| Independent coverage                                         | External readiness, missed cron, failed/missed queue-monitor job, and backup freshness checks remain operational when application email or Cloudflare telemetry is unavailable.                                                                              |

For account-side absence testing, inspect evaluation history as well as query
output. A query returning zero rows may never have caused the alert evaluator to
run. If a grouped query drops the missing service, test a separately scoped rule
or use the independent watchdog. Never coalesce absence to a healthy snapshot.

Record each command or UI action, UTC window, sanitized input counts, expected and
observed condition, evaluation history reference, opening/recovery receipt times,
cleanup result and remaining limitation in the private drill record. Restore the
isolated stage's original configuration after testing. Keep raw telemetry and
destination payloads in restricted evidence storage, outside the repo.

When credentials or destination are unavailable, perform a local scenario walk
through and label every provider row blocked. Request only the identified missing
account/stage, authorized access route, or explicit destination. Local repository
validation can pass while every live delivery check remains unverified.
