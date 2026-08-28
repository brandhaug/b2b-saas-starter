import { auditRequiredEnv, type RequiredEnvAudit } from '@b2b-saas-starter/env/server'
import { Effect } from 'effect'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { withWebRequestScope } from '@/lib/observability'

/**
 * Raised when the worker would authenticate users on an insecure required
 * secret. Deliberately a plain `Error` subclass, not an Effect typed error:
 * it crosses the TanStack middleware boundary, which has no error channel,
 * and every request fails with it until the deployment is fixed.
 */
export class InsecureProductionEnvError extends Error {
  constructor(problems: RequiredEnvAudit['problems']) {
    super(
      `Refusing to serve: required env is insecure — ${problems
        .map((problem) => `${problem.key} (${problem.reason})`)
        .join(', ')}. Set real values before deploying with ENVIRONMENT=production.`
    )
    this.name = 'InsecureProductionEnvError'
  }
}

/** The pure decision, exported for tests: production + problems → throw. */
export function enforceRequiredEnvAudit(audit: RequiredEnvAudit): void {
  if (audit.mode !== 'production' || audit.problems.length === 0) {
    return
  }
  // oxlint-disable-next-line effect/noThrowStatement -- the TanStack request middleware has no Effect error channel; this throw crossing that boundary IS the gate
  throw new InsecureProductionEnvError(audit.problems)
}

let verdict: 'ok' | 'warned' | undefined

/**
 * The before-production gate (see the secret matrix in ARCHITECTURE.md).
 * Runs once per isolate, on the first request the worker serves, because a
 * Worker has no boot hook with env access — the first request is the boot.
 *
 * - `ENVIRONMENT` unset (local dev, tests): silent — the local-mode defaults
 *   are expected there.
 * - `ENVIRONMENT=production` with a missing, placeholder, or too-short
 *   `BETTER_AUTH_SECRET` or a placeholder `BETTER_AUTH_URL`: every request
 *   fails with {@link InsecureProductionEnvError} until the deploy is fixed.
 *   The gate re-runs on each request in that state, so a fix rolled out
 *   without a new isolate starts serving immediately.
 * - Any other `ENVIRONMENT` (staging, preview, manual `wrangler deploy`):
 *   one `config.insecure` wide event per isolate — problems are named by key
 *   and reason, never by value — and the app keeps serving.
 */
export function enforceRequiredEnvOnce(): void {
  if (verdict === 'ok') {
    return
  }
  const audit = auditRequiredEnv(cloudflareEnv)
  if (audit.problems.length === 0) {
    verdict = 'ok'
    return
  }
  if (audit.mode === 'production') {
    // oxlint-disable-next-line effect/noThrowStatement -- deliberate refusal to serve: the request middleware has no error channel, and failing every request until the deployment is fixed is the point
    throw new InsecureProductionEnvError(audit.problems)
  }
  if (verdict === 'warned') {
    return
  }
  verdict = 'warned'
  // Standalone scope, not nested in the triggering request: this is a
  // boot-time config event, one per isolate, not traffic telemetry. The
  // missing-request lookup forces the standalone branch of
  // `withWebRequestScope` (its `scope: 'standalone'` tag reads as "not part
  // of any request", which is the truth here).
  void Effect.runPromiseExit(
    withWebRequestScope(
      {
        event: 'config.insecure',
        metadata: { environment: audit.mode, problems: audit.problems }
      },
      Effect.void,
      () => undefined
    )
  )
}
