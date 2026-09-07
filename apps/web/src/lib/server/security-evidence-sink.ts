import {
  makeHttpSecurityEvidenceSink,
  recordSecurityEvidence,
  type SecurityEvidenceKind,
  type SecurityEvidenceSink
} from '@b2b-saas-starter/capabilities/governance/security-recovery-evidence'
import { Effect } from 'effect'
import { hasValue } from '@b2b-saas-starter/env/server'
import { captureMonitoringSignal } from '@b2b-saas-starter/logger/providers'
import { env } from 'cloudflare:workers'

/** Server-only adapter: external append store plus Sentry as the independent gap path. */
export function makeSecurityEvidenceSink(): SecurityEvidenceSink | undefined {
  if (!hasValue(env.SECURITY_EVIDENCE_URL) || !hasValue(env.SECURITY_EVIDENCE_TOKEN)) {
    return undefined
  }
  return makeHttpSecurityEvidenceSink({
    url: env.SECURITY_EVIDENCE_URL,
    token: env.SECURITY_EVIDENCE_TOKEN,
    reportGap: (gap) =>
      captureMonitoringSignal('security_evidence_gap', {
        service: 'web',
        environment: env.ENVIRONMENT,
        evidenceId: gap.evidenceId,
        evidenceKind: gap.kind,
        subjectId: gap.subjectId,
        workspaceId: gap.workspaceId ?? undefined
      })
  })
}

/** Auth-catchall bridge for successful Better Auth mutations. */
export function recordEvidence(
  kind: SecurityEvidenceKind,
  subjectId: string
): Effect.Effect<void> {
  return recordSecurityEvidence({ kind, subjectId }, makeSecurityEvidenceSink()).pipe(
    Effect.asVoid
  )
}
