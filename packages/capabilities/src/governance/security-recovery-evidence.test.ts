/* oxlint-disable effect/noAsyncFunction -- Promise-returning fakes exercise the sink port */
import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { describe, expect, vi } from 'vite-plus/test'

import {
  revokeWithEvidence,
  type SecurityEvidenceInput
} from './security-recovery-evidence'

const input = {
  kind: 'api_token_revoked',
  subjectId: 'token-1'
} satisfies SecurityEvidenceInput

describe('security recovery evidence', () => {
  it.live('revokes before writing evidence and succeeds when the sink is healthy', () =>
    Effect.gen(function* () {
      const order: Array<string> = []
      const result = yield* revokeWithEvidence(
        Effect.sync(() => {
          order.push('revoke')
          return true
        }),
        input,
        {
          append: async () => {
            order.push('append')
          },
          reportGap: async () => {
            order.push('gap')
          }
        }
      )
      expect(result).toEqual({ revoked: true, evidence: 'recorded' })
      expect(order).toEqual(['revoke', 'append'])
    })
  )

  it.live('keeps urgent revocation successful when evidence persistence fails', () =>
    Effect.gen(function* () {
      const reportGap = vi.fn(async () => undefined)
      const result = yield* revokeWithEvidence(Effect.succeed(true), input, {
        append: async () => {
          throw new Error('independent store unavailable')
        },
        reportGap
      })
      expect(result).toEqual({ revoked: true, evidence: 'gap' })
      expect(reportGap).toHaveBeenCalledWith({
        evidenceId: expect.stringMatching(/^sec_/),
        kind: 'api_token_revoked',
        subjectId: 'token-1',
        workspaceId: null
      })
    })
  )

  it.live('does not create evidence when there was nothing to revoke', () =>
    Effect.gen(function* () {
      const append = vi.fn(async () => undefined)
      const result = yield* revokeWithEvidence(Effect.succeed(false), input, {
        append,
        reportGap: async () => undefined
      })
      expect(result).toEqual({ revoked: false, evidence: 'not_needed' })
      expect(append).not.toHaveBeenCalled()
    })
  )
})
