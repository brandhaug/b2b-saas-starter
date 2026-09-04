import { type AuthAccountChange, type AuthAccountHooks } from '@b2b-saas-starter/auth'
import {
  AuditEventLog,
  type RecordAuditEventInput
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { Effect } from 'effect'
import { runCapabilities } from '@/lib/capabilities'
import { webRuntime } from '@/lib/observability'
import { causeMessage } from '@/lib/cause-message'

/**
 * The account-linking audit adapter: what `packages/auth` hands to Better
 * Auth's `databaseHooks.account` ports. Linking a sign-in provider to an
 * account is a security-relevant mutation (ADR 0025's boundary), so every
 * social link and unlink records an Audit Event through the governance
 * capability — attributed to the user whose account changed, naming the
 * provider in the metadata.
 *
 * Best-effort by the same contract as `auth-audit/record.ts`: a failed write
 * is logged, never thrown — a governance hiccup must not fail the sign-in
 * exchange that triggered it. Under the Seed layer (no DB binding) `record`
 * is a no-op by design, so local dev without a database records nothing.
 *
 * The hooks fire for credential accounts too (the email/password sign-up
 * path); those are excluded here — that lifecycle already has its own audit
 * row (`auth.sign_up` over `/sign-up/email`).
 */

/** The account row provider ids that are not social providers. */
const CREDENTIAL_PROVIDER_ID = 'credential'

/** The event pair this adapter records. */
type AccountAuditEventType = 'auth.account_linked' | 'auth.account_unlinked'

/** The audit input one account change records — exported for the test. */
export function accountAuditInput(
  eventType: AccountAuditEventType,
  account: AuthAccountChange
): RecordAuditEventInput {
  return {
    workspaceId: null,
    actorUserId: account.userId,
    eventType,
    targetType: 'user',
    targetId: account.userId,
    metadata: { provider: account.providerId }
  }
}

/**
 * How this module reaches the capability layer, as a port — the same shape
 * `auth-audit/shared.ts` injects, so a test drives the adapter with a real
 * function instead of replacing `@/lib/capabilities`.
 */
export type RunAccountAudit = (
  effect: Effect.Effect<void, CapabilityUnavailable, AuditEventLog>
) => Promise<void>

function makeAccountHook(
  eventType: AccountAuditEventType,
  run: RunAccountAudit
): (account: AuthAccountChange) => Promise<void> {
  return (account) =>
    run(
      Effect.gen(function* () {
        // The credential account of an email/password sign-up is not a
        // linked provider — that lifecycle already has its own audit row.
        if (account.providerId === CREDENTIAL_PROVIDER_ID) {
          return
        }
        const audit = yield* AuditEventLog
        yield* audit.record(accountAuditInput(eventType, account))
      })
    )
}

/**
 * The `AuthConfig.accountHooks` port. `run` is the capabilities boundary and
 * defaults to the app's runner; the rejection handler is what makes the whole
 * port best-effort — Better Auth must never see a failed audit write.
 */
export function makeSocialAccountAuditHooks(
  run: RunAccountAudit = runCapabilities
): AuthAccountHooks {
  const recordLinked = makeAccountHook('auth.account_linked', run)
  const recordUnlinked = makeAccountHook('auth.account_unlinked', run)
  return {
    onAccountLinked: (account) =>
      recordLinked(account).catch(
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the rejected value is a cause to log, not input to parse; `: unknown` is the safe annotation the catch-callback rule itself demands
        (error: unknown) => reportDroppedAudit('link', account, error)
      ),
    onAccountUnlinked: (account) =>
      recordUnlinked(account).catch(
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the rejected value is a cause to log, not input to parse; `: unknown` is the safe annotation the catch-callback rule itself demands
        (error: unknown) => reportDroppedAudit('unlink', account, error)
      )
  }
}

/** The instance the auth runtime supplies (`lib/auth-runtime.ts`). */
export const socialAccountAuditHooks: AuthAccountHooks = makeSocialAccountAuditHooks()

/**
 * A dropped audit write is never silent: the reason goes to the isolate's
 * error log, the same visibility `writeAndReport` gives the exchange-based
 * audit path. There is no ambient Effect here to annotate — Better Auth calls
 * the hook as a plain promise — so the wide-event logger's runtime is the
 * surface.
 */
function reportDroppedAudit(
  change: 'link' | 'unlink',
  account: AuthAccountChange,
  cause: unknown
): void {
  void webRuntime.runPromise(
    Effect.logError(
      `social account audit dropped (${change}, provider ${account.providerId}, user ${account.userId}): ${causeMessage(cause, 'no reason given')}`
    )
  )
}
