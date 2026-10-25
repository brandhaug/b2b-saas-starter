# Release-aware smoke verification

Implemented from the approved deployment-check recommendation in the Ratstack
audit. No issue number was supplied. The upstream audit baseline was
`51964a1fa52bed2a4a36defabad1ee17d360fe23`; this implementation retains the
starter's existing deployment workflows and version bindings.

## Repeatable HTTP scenarios

From the repository root after `vp install`:

```sh
vp test run .github/scripts/smoke-deployment.test.ts
```

Observed on 2026-10-25: 14 scenarios passed. The suite uses a real local TCP
server and the production probe's fetch and artifact writer. It checks the
result written to disk, including outcome, timestamps, expected identity and
attempts. Its failure inventory preceded implementation.

| Scenario                                      | Required result                        |
| --------------------------------------------- | -------------------------------------- |
| Current API, homepage and stylesheet          | passed                                 |
| Old response followed by the expected release | passed, with earlier attempts retained |
| Canonical 307 `/` to `/en`                    | passed after destination verification  |
| Healthy old commit                            | failed                                 |
| Missing identity                              | unknown                                |
| HTTP 200 with an invalid health payload       | failed                                 |
| Login HTML                                    | failed                                 |
| Unexpected redirect                           | failed                                 |
| HTML returned for the required stylesheet     | failed                                 |
| Malformed stylesheet URL                      | failed, with observations retained     |
| Headers never arrive                          | unknown                                |
| Body never completes                          | unknown                                |
| Connection is dropped                         | unknown                                |
| Expected identity unavailable                 | unknown                                |

The malformed-URL scenario reproduced a review finding before the repair.
It now retains the observed responses and retries rather than reporting an
empty attempt list.

## Application readback

The compiled web entry returned 307 with `Location: /en` from `/`. The `/en`
response returned HTTP 200, the injected commit and build version, the public
homepage marker, and a stylesheet path present in `dist/client/assets`.
The API entry returned HTTP 200, `{ "status": "ok" }`, the injected identity
and `Cache-Control: no-store`. This local readback found the canonical locale
redirect that a mock-only test would have missed.

These are local serving checks, not Cloudflare propagation measurements.
Use the [deployment readback command](../deploying.md#release-aware-smoke-evidence)
against deployed origins for retained production or preview evidence. CI uploads
the structured artifact even when the probe fails.

## Reviews

Two independent reviewers ran Standards plus maintainability and Spec reviews.
The first round found duplicate identity rules and discarded observations on a
malformed asset URL. Both were repaired. Both second-round reviews reported zero
remaining findings against implementation tree
`88947b5a835020151d5531141ad254cf5e3610ce`.

Implementation and both review rounds used the inherited GPT-6 Astra model.
Token and cost counters were unavailable. The PR records integrated validation
and CI results for its final commit.
