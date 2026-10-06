# First business feature verification

The public tutorial is at `/en/docs/getting-started/first-business-feature`.
`workspace-notes.patch` contains reader-added code, not an installed Starter
feature. Its base is `caf4756fd620a660743f2734b85aad151d75a82a`.

## Observed results

Verified locally on 2026-10-06 with the companion patch applied. The patch was
also applied to a fresh archive of the baseline; all 30 resulting example files
were byte-identical to the integrated files tested here. Generated migrations
were produced separately with `pnpm run db:generate`.

| Check                                                                   | Result                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| Patch application against the recorded baseline                         | Passed                                                       |
| Repository typecheck and type-aware lint                                | Passed                                                       |
| REST, permission matrix, MCP discovery and mutation protocol tests      | 58 passed                                                    |
| Focused built-preview Playwright case on port 3104                      | 1 passed, 47.4 seconds                                       |
| Manual Wrangler command using shared local D1, read-only seed-token GET | HTTP 200, included the browser-created note                  |
| Full example `E2E_PORT=3104 pnpm run validate`                          | Stopped at existing auth test timeout; isolated retry passed |
| UI mechanical detector                                                  | No findings                                                  |

The [saved-note screenshot](./persisted-note.png) shows the member page after a
reload. The browser test also rejected an outsider's page read and forged write.

The first browser attempt confirmed the server write but timed out waiting for
loader invalidation. The final case allows 30 seconds for that refresh. A cold
dev-server attempt exceeded startup readiness, so the focused configuration runs
a prebuilt preview. The D1 protocol fixture has a 60-second budget because it
starts workerd and applies the complete migration history.

Full example validation passed typecheck, lint, formatting, dead-code analysis,
and unused-message checks, then stopped at the existing
`packages/auth/src/live-totp-replay.test.ts` five-second timeout. Running
`pnpm -C packages/auth exec vp test run src/live-totp-replay.test.ts` immediately
afterward passed. The full example validation did not reach its build or browser
stages; the separately built focused browser result above is the persistence
and authorization evidence. An additional capability coverage run was stopped
after unrelated billing, webhook, and assistant cases also timed out; it is not
reported as a passing suite.

## Reproduce

From a clean checkout containing the tutorial, create a separate example checkout
and local database. Use an unused sibling directory name if this one exists.

```bash
git worktree add --detach ../first-business-feature-example HEAD
cd ../first-business-feature-example
vp install
cp .env.example .env
git apply --check docs/examples/first-business-feature/workspace-notes.patch
git apply docs/examples/first-business-feature/workspace-notes.patch
pnpm run db:generate
pnpm run db:migrate:local
pnpm run db:seed
pnpm -C apps/web exec playwright install chromium
pnpm run check
pnpm -C apps/api exec vp test run src/workspace-notes.test.ts src/permission-matrix.test.ts
pnpm -C apps/web build:e2e
E2E_PORT=3104 pnpm -C apps/web exec playwright test --config playwright.notes.config.ts
E2E_PORT=3104 pnpm run validate
```

Do not run development servers on port 3104 during validation. The browser suite
starts its own server. The local D1 directory belongs to this example checkout;
none of these commands targets Cloudflare-hosted data.

## What the checks prove

- The REST protocol suite provisions an isolated workerd D1 with all migrations.
  A write-scope credential creates a note. A newly constructed handler reads it;
  direct SQL confirms the persisted row and its `api_token` audit provenance.
- The same protocol suite proves that a different Workspace's stored note does
  not appear in the result, and that missing credentials, invalid text, and
  cross-Workspace token requests are refused.
- The Seed protocol pass exercises create/list through the same HTTP contract and
  refuses a read-only token's create request.
- The permission matrix pins both endpoints and checks bearer middleware,
  rate-limit registration, and the scope policy. The authz matrix pins the
  separate member, owner, admin, and token grants.
- Playwright signs in the seeded member, creates a unique note, reloads, and
  confirms it remains. It creates a separate outsider session, checks that the
  note page returns not found, and attempts the captured mutation with outsider
  cookies. A member reload confirms that no injected note exists.

The browser case writes `persisted-note.png` under `apps/web/test-results`.
Playwright writes `apps/web/playwright-report/notes.json` and retains a trace
on failure. The JSON report and traces are local artifacts. The selected persistence
screenshot is copied here for review.
Record the source revision and command alongside them for later adopter runs.

## Limits

The example is create/list only. It has no note export, edit/delete controls,
retention deadline, paid quota, or notifications. The web page shows the newest
30 notes; REST/MCP page older data. Seed state lasts for its Layer scope, while
Live data persists in D1. The verification is local and uses no paid provider.
It does not establish deployed Worker behavior or provider delivery.

## Integration

Only tutorial documents, public documentation links, static LLM summaries, and
the companion patch belong in the final Starter diff. Applying the patch adds
notes to the reference application in the adopter's checkout. Its application
files do not alter the unpatched Starter.

Sibling adoption guides may also edit quickstart, architecture, or the static
LLM summaries. Preserve both sets of links when integrating. The patch's contexts
may need refreshing if sibling work changes the capability composition or shared
API contract. It assumes neither purchase-continuation nor annual-billing work.
