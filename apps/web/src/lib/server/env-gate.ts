import { auditRequiredEnv, type RequiredEnvAudit } from '@b2b-saas-starter/env/server'
import { Effect } from 'effect'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { webRuntime, withWebRequestScope } from '@/lib/observability'

/**
 * Raised when the worker would authenticate users on an insecure required
 * secret. Deliberately a plain `Error` subclass, not an Effect typed error:
 * it crosses the TanStack middleware boundary, which has no error channel,
 * and every request fails with it until the deployment is fixed.
 */
export class InsecureProductionEnvError extends Error {
  constructor() {
    // Start sends request-middleware error messages to server-function callers.
    super('Service unavailable')
    this.name = 'InsecureProductionEnvError'
  }
}

/**
 * The refusal decision, in one place: production + problems → throw.
 *
 * `enforceRequiredEnvOnce` below calls this rather than restating it, so the
 * branch the tests drive is the branch a request takes.
 */
export function enforceRequiredEnvAudit(audit: RequiredEnvAudit): void {
  if (audit.mode !== 'production' || audit.problems.length === 0) {
    return
  }
  // oxlint-disable-next-line effect/noThrowStatement -- the TanStack request middleware has no Effect error channel; this throw crossing that boundary IS the gate
  throw new InsecureProductionEnvError()
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
 *   `BETTER_AUTH_SECRET`, or a placeholder or non-`https:` `BETTER_AUTH_URL`:
 *   every request fails with {@link InsecureProductionEnvError} until the
 *   deploy is fixed. Diagnostics are logged once per isolate, never sent to
 *   callers. The gate re-runs on each request in that state, so a fix
 *   rolled out without a new isolate starts serving immediately.
 * - Any other `ENVIRONMENT` (staging, preview, manual `wrangler deploy`):
 *   one `config.insecure` wide event per isolate — problems are named by key
 *   and reason, never by value — and the app keeps serving.
 */
export async function enforceRequiredEnvOnce(): Promise<void> {
  if (verdict === 'ok') {
    return
  }
  const audit = auditRequiredEnv(cloudflareEnv)
  if (audit.problems.length === 0) {
    verdict = 'ok'
    return
  }
  if (verdict !== 'warned') {
    verdict = 'warned'
    // The gate precedes request observability. Record diagnostics in a
    // standalone scope before refusing production traffic.
    await webRuntime.runPromiseExit(
      withWebRequestScope(
        {
          event: 'config.insecure',
          metadata: {
            environment: audit.mode,
            ...Object.fromEntries(
              audit.problems.map(({ key, reason }) => [`config.${key}`, reason])
            )
          }
        },
        Effect.void
      )
    )
  }
  // A logged warning must never bypass the production refusal. Re-audit on
  // every failed request so corrected bindings can recover in this isolate.
  enforceRequiredEnvAudit(audit)
}
