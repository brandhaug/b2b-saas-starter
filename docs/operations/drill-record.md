# Isolated recovery drill record

Copy this record to the deployment's independent operations store. Replace all
empty fields with observed evidence. A planned command is not a completed drill.
Keep customer data, SQL dumps, secrets and raw provider payloads out of this record.

## Identity and boundaries

| Field                                             | Observed value |
| ------------------------------------------------- | -------------- |
| Operator and witness                              |                |
| UTC date and Git revision                         |                |
| Isolated Cloudflare account / stage / D1 ID       |                |
| Confirmation this is not a production target      |                |
| Independent backup provider / bucket / object key |                |
| Separate key/configuration recovery source        |                |
| Sentry project / environment / alert destinations |                |
| Tested D1 size and row counts                     |                |

## Recovery evidence

Record separate rows for Time Travel and independent-backup recovery. The
account-loss path must demonstrate access to configuration and decryption keys
without the production Cloudflare account.

| Observation                                     | Time Travel | Independent backup |
| ----------------------------------------------- | ----------- | ------------------ |
| Known fixture values and capture timestamp      |             |                    |
| Fault command and UTC timestamp                 |             |                    |
| Maintenance and queue-pause verification        |             |                    |
| Restore point / backup timestamp                |             |                    |
| Exact target confirmation                       |             |                    |
| Recovery start and finish                       |             |                    |
| Elapsed time and target pass/fail               |             |                    |
| Actual lost-write interval and target pass/fail |             |                    |
| Integrity and foreign-key checks                |             |                    |
| Users, Workspace, memberships and role checks   |             |                    |
| Revocations/deletions reapplied                 |             |                    |
| Evidence-gap resolution or blocked access       |             |                    |
| Old session, OAuth and API credentials rejected |             |                    |
| Fresh sign-in and permitted operation           |             |                    |
| Cross-Workspace access denied                   |             |                    |
| Outgoing work quarantined and queue disposition |             |                    |
| Stripe/current external state reviewed          |             |                    |
| Export links invalidated / ZIPs regenerated     |             |                    |
| Reopening authorization                         |             |                    |

Record the backup export start/end and interruption measurement method. Include
probe timestamps, maximum observed blocked interval, and conservative export
wall time. The interruption budget is 60 seconds. If it fails, record the revised
approach and repeat the drill at the same or greater size.

## Alert exercise evidence

| Controlled condition                                          | Fault / recovery commands | Incident ID | Open notification time / destination | Recovery notification time / destination | Deduplicated? |
| ------------------------------------------------------------- | ------------------------- | ----------- | ------------------------------------ | ---------------------------------------- | ------------- |
| Web readiness down for five minutes                           |                           |             |                                      |                                          |               |
| API readiness down for five minutes                           |                           |             |                                      |                                          |               |
| Worker error ratio >5%, >=20 requests in five minutes         |                           |             |                                      |                                          |               |
| Billing unresolved for fifteen minutes                        |                           |             |                                      |                                          |               |
| Queue backlog                                                 |                           |             |                                      |                                          |               |
| Queue retries exhausted                                       |                           |             |                                      |                                          |               |
| Scheduled job failure                                         |                           |             |                                      |                                          |               |
| Scheduled job missed completion                               |                           |             |                                      |                                          |               |
| Backup failure                                                |                           |             |                                      |                                          |               |
| Backup age >26 hours                                          |                           |             |                                      |                                          |               |
| Systemic transactional email failure                          |                           |             |                                      |                                          |               |
| Email-event processing failure                                |                           |             |                                      |                                          |               |
| Independent security-store unavailable during live revocation |                           |             |                                      |                                          |               |

For the transactional-email outage, confirm the independent operator email
arrived while transactional delivery remained broken. For the security-store
outage, confirm live credential revocation succeeded and later recovery either
replayed complete evidence or kept uncertain access blocked.

## Production decision

Record pass, fail or blocked for every criterion, with evidence links. Name the
operator approving production use, the next quarterly drill date, and any
remaining restrictions. Missing provider access or unexercised alerts mean the
recovery setup is not yet verified for customer deployment.
