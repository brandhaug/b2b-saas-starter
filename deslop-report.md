# Deslop Report — 2026-08-23

Scope: all tracked `*.ts` / `*.tsx` in `b2b-saas-starter-deslop` (248 files). Tools: oxlint, tsc.
Status: analysis only — no changes applied yet.

## Summary

| Category   | Findings | ≥0.7 confidence   | High severity |
| ---------- | -------- | ----------------- | ------------- |
| dedup      | 8        | 6                 | 1             |
| types      | 2        | 1                 | 0             |
| unused     | 12       | 5                 | 1             |
| weak-types | 0        | —                 | —             |
| defensive  | 2        | 0                 | 0             |
| legacy     | 3        | 1 (informational) | 0             |
| slop       | 2        | 1                 | 0             |

## Deduplication

| Conf | Sev  | Location                                                                                          | Issue                                                                                                                     |
| ---- | ---- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 0.97 | high | `apps/api/src/handlers.ts:349-402`                                                                | `revoke` and `delete` api-token handlers byte-identical except event name — extract shared handler                        |
| 0.93 | med  | `apps/web/src/lib/server/auth-emails.ts:29-35` + `invitations.ts:80-85`                           | identical `emailDispatcherLayer()` in two modules — consolidate                                                           |
| 0.86 | med  | `packages/capabilities/src/governance/workspace-membership.ts:181-226` (+ invitations, lifecycle) | binding-failure classify/`callBinding` copy-pasted 3× across governance Live adapters — parameterized factory             |
| 0.83 | med  | auth routes (`sign-in.tsx:120-199`, sign-up, forgot/reset-password)                               | email/password validators + submit-button block copy-pasted across 4 auth routes — shared validators + `AuthSubmitButton` |
| 0.82 | med  | `apps/web/src/lib/server/auth-audit.ts:482-590`                                                   | repeated write-and-report and read-untrusted-body blocks within file — extract local helpers                              |
| 0.78 | low  | `apps/background/src/index.ts:174-178`                                                            | `bytesToHex` re-implemented; exists in `packages/capabilities/src/internal/crypto.ts`                                     |
| 0.72 | low  | `apps/background/src/index.ts:262-276,385-425`                                                    | dead-letter handler repeats webhook preamble — extract decode/terminal-row helpers                                        |
| 0.70 | low  | governance seed layers ×3                                                                         | fabricated Member literal written 3× — `fabricateSeedMember()` helper                                                     |

## Type consolidation

| Conf | Sev | Location                                                | Issue                                                                                                  |
| ---- | --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 0.85 | med | `apps/web/src/lib/permissions.ts:20` + 3 server modules | `{ readonly role: WorkspaceRole } \| null` re-declared inline 4× — export named type from capabilities |
| 0.70 | low | 4 governance `.contract.ts` files                       | `ContractExpect` duplicated with drifted matcher surfaces — shared base + per-contract pick            |

## Unused code

| Conf | Sev  | Location                                                             | Issue                                                                                                 |
| ---- | ---- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 0.85 | high | `apps/web/src/components/code-block.tsx`                             | Dead file — `CodeBlock` never imported anywhere. May be intentional starter showcase surface; confirm |
| 0.90 | med  | `apps/api/src/rate-limit.ts:68`                                      | unused re-export `clientKey`                                                                          |
| 0.85 | med  | `apps/web/src/components/chart-defaults.ts:11-32`                    | `COMPACT_CHART_MARGIN`, `COMPACT_AXIS_TICK`, `COMPACT_TOOLTIP_STYLE` unused                           |
| 0.80 | low  | `apps/api/src/rate-limit.ts:24`, `apps/web/src/lib/rate-limit.ts:25` | unused exported type alias `RateLimitInput` (both)                                                    |
| 0.70 | low  | `apps/web/src/components/data-table.tsx:57`                          | `DataTableFeatures` only used internally — un-export                                                  |

Needs review (<0.7): un-exported-but-maybe-intentional error types — `MissingD1Binding`, `AuthLive` (auth-runtime.ts), `CapabilityUnavailableError`/`ForbiddenError` re-export (capabilities.ts), `FORBIDDEN_ERROR_NAME` (capability-error.ts), `AuthAuditBodyUnreadable`/`AuthAuditWriteFailed` (auth-audit.ts), `UnauthorizedError` (server/auth.ts); `adminScopeRole` alias (authz/roles.ts, 0.4).

## Weak types

No findings. Only `as any` lives in generated `routeTree.gen.ts`; all `unknown` usage is properly narrowed at boundaries.

## Defensive programming

Both findings below threshold — needs review:

- `packages/capabilities/src/developer-platform/webhook-publisher.ts:122` — identity `catch: (cause) => cause` widens without domain context (0.55)
- `apps/web/src/routes/api.auth.$.ts:47-48` — best-effort session read `.catch(() => null)` at trust boundary (0.4)

## Legacy

Nothing clearly dead. Informational:

- `apps/web/vite.config.ts:59-66` — workers-shim env guard effectively always-on via package scripts but reachable via bare vite (intentional escape hatch?) (0.55)
- webhook-publisher queue schema "legacy in-flight shape" test — historical once old messages drain (0.6)
- `cloudflare-workers-shim.ts` inert-in-prod — **intentional** (test bundle isolation), do not remove (0.9)

## AI slop

Comment quality is unusually high; no stubs, narrating comments, or commented-out code found.

- `apps/web/src/routes/_app.workspaces_.index.tsx`-adjacent → actually `packages/capabilities/src/governance/workspace-lifecycle.ts:172-178` — if/else push loop should be a one-line map (0.8)
- `apps/api/src/handlers.ts:377-397` — delete-as-revoke duplicate (overlaps dedup finding #1) (0.6)

## Verified false positives (excluded)

- `cloudflare-workers-shim*.ts` "unused files" — resolved by string alias in vite.config
- Per-app rate-limit config wrappers — deliberate thin config over shared package
- Seed-vs-Live capability layer duality — documented architecture
