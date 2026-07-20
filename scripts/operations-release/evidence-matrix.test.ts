import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { operationsSecurityEvidenceMatrix } from './evidence-matrix.ts'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const requiredClaims = [
  'audit:start-attempt',
  'audit:handoff',
  'audit:activation',
  'audit:stop',
  'audit:expiry',
  'audit:revocation',
  'audit:rejection',
  'audit:sensitive-read',
  'audit:mutation-accepted',
  'audit:mutation-rejected',
  'retention:stable-identifiers-two-years',
  'retention:survives-identity-deletion',
  'privacy:reason-and-reference-protected',
  'rate-limit:session-read',
  'rate-limit:authentication',
  'rate-limit:totp',
  'rate-limit:search',
  'rate-limit:management',
  'rate-limit:impersonation-start',
  'rate-limit:handoff-exchange',
  'notification:start',
  'notification:stop',
  'notification:expiry',
  'notification:revocation',
  'notification:atomic-intent',
  'notification:asynchronous-retry',
  'notification:idempotent-delivery',
  'notification:deterministic-local-capture',
  'notification:sanitized-content',
  'isolation:cookie',
  'isolation:secret',
  'isolation:base-url',
  'isolation:trusted-origin',
  'isolation:top-level-post',
  'isolation:normal-session-rejection',
  'authorization:merchant-reader',
  'authorization:merchant-impersonator',
  'authorization:impersonation-auditor',
  'authorization:operator-manager',
  'authorization:stock-admin-endpoints-denied',
  'identity:disjoint-classes',
  'operator:invitation-and-enrollment',
  'operator:single-session',
  'operator:absolute-session-limit',
  'operator:idle-session-limit',
  'operator:recovery',
  'impersonation:operator-concurrency',
  'impersonation:target-concurrency',
  'impersonation:reduced-authority-intersection',
  'impersonation:denied-action-categories',
  'impersonation:allowed-reversible-actions',
  'impersonation:immediate-revocation',
  'browser:search-to-target',
  'browser:fresh-totp',
  'browser:post-handoff',
  'browser:persistent-banner',
  'browser:allowed-action',
  'browser:denied-action',
  'browser:normal-session-rejection',
  'browser:stop',
  'browser:expiry',
  'browser:revocation',
  'browser:return-to-operations',
  'production:missing-secret-fails-closed',
  'production:missing-email-fails-closed',
  'production:cloudflare-access-deferred',
  'cutover:legacy-auth-removed',
  'cutover:public-admin-docs-removed',
  'cutover:six-worker-runtime-documented',
  'cutover:operator-procedures-documented'
] as const

describe('Operations security and evidence release matrix', () => {
  it('owns every release-blocking claim exactly once at an established public seam', () => {
    const claims = operationsSecurityEvidenceMatrix.flatMap((control) => control.claims)

    expect([...claims].sort()).toEqual([...requiredClaims].sort())
    expect(new Set(claims).size).toBe(claims.length)
    expect(
      operationsSecurityEvidenceMatrix.every(
        (control) => control.evidence.length > 0 && control.seams.length > 0
      )
    ).toBe(true)
  })

  it('keeps every mapped test executable from its owning workspace', () => {
    for (const control of operationsSecurityEvidenceMatrix) {
      for (const evidence of control.evidence) {
        expect(
          existsSync(resolve(repositoryRoot, evidence.workspace, evidence.testFile)),
          `${control.id}: ${evidence.workspace}/${evidence.testFile}`
        ).toBe(true)
      }
    }
  })
})
