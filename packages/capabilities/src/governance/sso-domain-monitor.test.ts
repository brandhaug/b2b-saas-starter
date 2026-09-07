import { workspaceSsoDomainClaims } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { expect, layer } from '@effect/vitest'

import { hashSha256 } from '../crypto.ts'
import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { checkSsoDomains } from './sso-domain-monitor.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live SSO domain monitor',
  (it) => {
    it.effect(
      'starts one seven-day grace period, does not extend it, then restores verification',
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          const token = 'monitor-token'
          const tokenHash = yield* Effect.promise(() => hashSha256(token))
          const now = '1970-01-01T00:00:00.000Z'
          yield* db.insert(workspaceSsoDomainClaims).values({
            id: 'claim_monitor',
            workspaceId: 'wrk_live',
            providerId: 'sso_monitor',
            domain: 'monitor.test',
            verificationTokenHash: tokenHash,
            status: 'verified',
            verifiedAt: now,
            lastCheckedAt: now,
            graceUntil: null,
            createdAt: now,
            updatedAt: now
          })

          function missing() {
            return Promise.resolve([] satisfies ReadonlyArray<ReadonlyArray<string>>)
          }
          yield* inWorkspace('live-lab', checkSsoDomains(missing), {
            userId: 'usr_owner',
            sessionId: 'ses_sso_owner'
          })
          const [first] = yield* db
            .select()
            .from(workspaceSsoDomainClaims)
            .where(eq(workspaceSsoDomainClaims.id, 'claim_monitor'))
          expect(first?.status).toBe('grace')
          expect(first?.graceUntil).toBe('1970-01-08T00:00:00.000Z')
          const deadline = first?.graceUntil

          function dnsError() {
            return Promise.reject(new Error('DNS unavailable'))
          }
          yield* inWorkspace('live-lab', checkSsoDomains(dnsError), {
            userId: 'usr_owner',
            sessionId: 'ses_sso_owner'
          })
          const [second] = yield* db
            .select()
            .from(workspaceSsoDomainClaims)
            .where(eq(workspaceSsoDomainClaims.id, 'claim_monitor'))
          expect(second?.status).toBe('grace')
          expect(second?.graceUntil).toBe(deadline)

          yield* TestClock.adjust('8 days')
          yield* inWorkspace('live-lab', checkSsoDomains(missing), {
            userId: 'usr_owner',
            sessionId: 'ses_sso_owner'
          })
          const [failed] = yield* db
            .select()
            .from(workspaceSsoDomainClaims)
            .where(eq(workspaceSsoDomainClaims.id, 'claim_monitor'))
          expect(failed?.status).toBe('failed')
          expect(failed?.graceUntil).toBe('1970-01-08T00:00:00.000Z')

          function restored() {
            return Promise.resolve([[`_better-auth-token-sso_monitor=${token}`]])
          }
          yield* inWorkspace('live-lab', checkSsoDomains(restored), {
            userId: 'usr_owner',
            sessionId: 'ses_sso_owner'
          })
          const [healthy] = yield* db
            .select()
            .from(workspaceSsoDomainClaims)
            .where(
              and(
                eq(workspaceSsoDomainClaims.id, 'claim_monitor'),
                eq(workspaceSsoDomainClaims.status, 'verified')
              )
            )
          expect(healthy?.graceUntil).toBeNull()
          expect(healthy?.verifiedAt).not.toBeNull()
        })
    )
  }
)
