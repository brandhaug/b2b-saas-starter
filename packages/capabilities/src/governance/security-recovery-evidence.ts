import { DateTime, Effect, Result, Schema } from 'effect'

import { newCapabilityId } from '../internal/ids.ts'

/** Security changes that must be replayed after restoring an older database. */
export const SecurityEvidenceKind = Schema.Literals([
  'account_deleted',
  'workspace_deleted',
  'workspace_access_removed',
  'api_token_revoked',
  'oauth_grant_revoked',
  'sessions_revoked',
  'credential_changed'
])
export type SecurityEvidenceKind = typeof SecurityEvidenceKind.Type

/** Sanitized append-only evidence. No secret or provider payload belongs here. */
export const SecurityEvidenceRecord = Schema.Struct({
  id: Schema.String,
  kind: SecurityEvidenceKind,
  subjectId: Schema.String,
  workspaceId: Schema.NullOr(Schema.String),
  occurredAt: Schema.String,
  source: Schema.Literal('live')
})
export type SecurityEvidenceRecord = typeof SecurityEvidenceRecord.Type

export type SecurityEvidenceInput = {
  readonly kind: SecurityEvidenceKind
  readonly subjectId: string
  readonly workspaceId?: string | undefined
}

export type SecurityEvidenceGap = {
  readonly evidenceId: string
  readonly kind: SecurityEvidenceKind
  readonly subjectId: string
  readonly workspaceId: string | null
}

/** A store outside the production Cloudflare account plus an independent alert path. */
export type SecurityEvidenceSink = {
  readonly append: (record: SecurityEvidenceRecord) => Promise<void>
  readonly reportGap: (gap: SecurityEvidenceGap) => Promise<void>
}

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call
class SecurityEvidenceWriteFailed extends Schema.TaggedError<SecurityEvidenceWriteFailed>()(
  'SecurityEvidenceWriteFailed',
  { status: Schema.Number }
) {}

/** Build the HTTP store adapter while leaving alert delivery with the owning app. */
// The global web APIs are deliberate at this small platform adapter boundary.
// oxlint-disable effect/noGlobals, effect/noThrowStatement
export function makeHttpSecurityEvidenceSink(options: {
  readonly url: string
  readonly token: string
  readonly reportGap: SecurityEvidenceSink['reportGap']
}): SecurityEvidenceSink {
  const authorization = `Bearer ${options.token}`
  return {
    append: (record) =>
      fetch(options.url, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify(record),
        signal: AbortSignal.timeout(3000)
      }).then(requireSuccessfulAppend),
    reportGap: options.reportGap
  }
}

function requireSuccessfulAppend(response: Response): void {
  if (!response.ok) {
    throw new SecurityEvidenceWriteFailed({ status: response.status })
  }
}
// oxlint-enable effect/noGlobals, effect/noThrowStatement

export type EvidenceOutcome = 'recorded' | 'gap'

/** Record a completed mutation. A failed write is alerted and never undoes it. */
export function recordSecurityEvidence(
  input: SecurityEvidenceInput,
  sink: SecurityEvidenceSink | undefined
): Effect.Effect<EvidenceOutcome> {
  if (sink === undefined) {
    return Effect.succeed('recorded')
  }
  return Effect.gen(function* () {
    const now = yield* DateTime.now
    const record: SecurityEvidenceRecord = {
      id: yield* newCapabilityId('sec'),
      kind: input.kind,
      subjectId: input.subjectId,
      workspaceId: input.workspaceId ?? null,
      occurredAt: DateTime.formatIso(now),
      source: 'live'
    }
    const appended = yield* Effect.result(
      Effect.tryPromise({
        try: () => sink.append(record),
        catch: () => 'security_evidence_unavailable'
      })
    )
    if (Result.isSuccess(appended)) {
      return 'recorded'
    }
    yield* Effect.tryPromise({
      try: () =>
        sink.reportGap({
          evidenceId: record.id,
          kind: record.kind,
          subjectId: record.subjectId,
          workspaceId: record.workspaceId
        }),
      catch: () => 'security_evidence_gap_alert_failed'
    }).pipe(Effect.ignore)
    yield* Effect.logError('security recovery evidence was not persisted').pipe(
      Effect.annotateLogs({
        evidenceId: record.id,
        evidenceKind: record.kind,
        subjectId: record.subjectId,
        workspaceId: record.workspaceId
      })
    )
    return 'gap'
  })
}

/** Run the live mutation first, then persist evidence only when it matched. */
export function revokeWithEvidence<E, R>(
  revoke: Effect.Effect<boolean, E, R>,
  input: SecurityEvidenceInput,
  sink: SecurityEvidenceSink | undefined
): Effect.Effect<
  { readonly revoked: boolean; readonly evidence: EvidenceOutcome | 'not_needed' },
  E,
  R
> {
  return Effect.gen(function* () {
    const revoked = yield* revoke
    if (!revoked) {
      return { revoked: false, evidence: 'not_needed' }
    }
    const evidence = yield* recordSecurityEvidence(input, sink)
    return { revoked: true, evidence }
  })
}
