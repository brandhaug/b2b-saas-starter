import {
  makeHttpSecurityEvidenceSink,
  type SecurityEvidenceSink
} from '@b2b-saas-starter/capabilities/governance/security-recovery-evidence'
import { hasValue } from '@b2b-saas-starter/env/server'
import { captureMonitoringSignal } from '@b2b-saas-starter/logger/providers'

import { type ApiEnv } from './env.ts'

/** API-worker adapter for the independent append store and Sentry gap alert. */
export function securityEvidenceSink(env: ApiEnv): SecurityEvidenceSink | undefined {
  if (!hasValue(env.SECURITY_EVIDENCE_URL) || !hasValue(env.SECURITY_EVIDENCE_TOKEN)) {
    return undefined
  }
  return makeHttpSecurityEvidenceSink({
    url: env.SECURITY_EVIDENCE_URL,
    token: env.SECURITY_EVIDENCE_TOKEN,
    reportGap: (gap) =>
      captureMonitoringSignal('security_evidence_gap', {
        service: 'api',
        environment: env.ENVIRONMENT,
        evidenceId: gap.evidenceId,
        evidenceKind: gap.kind,
        subjectId: gap.subjectId,
        workspaceId: gap.workspaceId ?? undefined
      })
  })
}
