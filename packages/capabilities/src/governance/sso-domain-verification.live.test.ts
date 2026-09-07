import {
  verification,
  workspaceMembers,
  workspaceSsoConnections,
  workspaceSsoDomainClaims
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { and, eq } from 'drizzle-orm'
import { Effect } from 'effect'
import { expect, layer } from '@effect/vitest'

import { failureTag } from '../internal/failure-tag.ts'
import {
  fakeSsoBinding,
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { SsoConnections } from './workspace-sso-connections.ts'

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live SSO domain verification',
  (it) => {
    it.effect(
      'does not reserve an unverified domain and rejects a cross-workspace claim',
      () =>
        Effect.gen(function* () {
          const db = yield* Database
          yield* db.insert(workspaceMembers).values({
            id: 'mem_other_owner',
            workspaceId: 'wrk_other',
            userId: 'usr_owner',
            role: 'owner'
          })
          const { binding } = fakeSsoBinding(db)

          const result = yield* Effect.exit(
            inWorkspace(
              'other-lab',
              Effect.flatMap(SsoConnections, (sso) =>
                sso.verifyDomain({ providerId: 'sso_other_oidc' })
              ),
              { userId: 'usr_owner', sessionId: 'ses_sso_owner' },
              { ssoBinding: binding }
            )
          )
          expect(failureTag(result)).toBe('MembershipChangeRejected')

          const [claim] = yield* db
            .select()
            .from(workspaceSsoDomainClaims)
            .where(eq(workspaceSsoDomainClaims.domain, 'routed.test'))
          expect(claim?.workspaceId).toBe('wrk_live')
          expect(claim?.status).toBe('verified')
        })
    )

    it.effect('verifies through the plugin and creates the unique D1 claim', () =>
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(workspaceSsoConnections).values({
          id: 'sso_domain_new',
          issuer: 'https://idp.new.test',
          // oxlint-disable-next-line effect/noGlobals -- fixture config is the plugin's persisted JSON shape
          oidcConfig: JSON.stringify({ clientId: 'new-client' }),
          samlConfig: null,
          userId: 'usr_owner',
          providerId: 'sso_domain_new',
          workspaceId: 'wrk_live',
          domain: 'new.test',
          enabled: false,
          requireSso: false,
          defaultWorkspaceRole: 'member',
          // oxlint-disable-next-line effect/noGlobals -- fixed fixture timestamp
          createdAt: new Date(0)
        })
        const { binding } = fakeSsoBinding(db)

        yield* inWorkspace(
          'live-lab',
          Effect.flatMap(SsoConnections, (sso) =>
            sso.verifyDomain({ providerId: 'sso_domain_new' })
          ),
          { userId: 'usr_owner', sessionId: 'ses_sso_owner' },
          { ssoBinding: binding }
        )

        const [claim] = yield* db
          .select()
          .from(workspaceSsoDomainClaims)
          .where(
            and(
              eq(workspaceSsoDomainClaims.workspaceId, 'wrk_live'),
              eq(workspaceSsoDomainClaims.domain, 'new.test')
            )
          )
        expect(claim).toMatchObject({
          providerId: 'sso_domain_new',
          status: 'verified',
          domain: 'new.test'
        })
        const [connection] = yield* db
          .select()
          .from(workspaceSsoConnections)
          .where(eq(workspaceSsoConnections.providerId, 'sso_domain_new'))
        expect(connection?.domainVerified).toBe(true)
      })
    )

    it.effect('retries an already-verified plugin after a retained challenge', () =>
      Effect.gen(function* () {
        const db = yield* Database
        // oxlint-disable-next-line effect/noGlobals -- fixed fixture timestamp
        const now = new Date(0)
        yield* db.insert(workspaceSsoConnections).values({
          id: 'sso_domain_retry',
          issuer: 'https://idp.retry.test',
          // oxlint-disable-next-line effect/noGlobals -- fixture config is the plugin's persisted JSON shape
          oidcConfig: JSON.stringify({ clientId: 'retry-client' }),
          samlConfig: null,
          userId: 'usr_owner',
          providerId: 'sso_domain_retry',
          workspaceId: 'wrk_live',
          domain: 'retry.test',
          enabled: false,
          requireSso: false,
          domainVerified: true,
          defaultWorkspaceRole: 'member',
          createdAt: now
        })
        yield* db.insert(verification).values({
          id: 'verification_retry',
          identifier: '_better-auth-token-sso_domain_retry',
          value: 'verify-sso_domain_retry',
          // oxlint-disable-next-line effect/noGlobals -- fixed retained-challenge fixture timestamp
          expiresAt: new Date(now.getTime() + 60_000),
          createdAt: now,
          updatedAt: now
        })
        const { binding } = fakeSsoBinding(db)

        yield* inWorkspace(
          'live-lab',
          Effect.flatMap(SsoConnections, (sso) =>
            sso.verifyDomain({ providerId: 'sso_domain_retry' })
          ),
          { userId: 'usr_owner', sessionId: 'ses_sso_owner' },
          { ssoBinding: binding }
        )

        const [claim] = yield* db
          .select()
          .from(workspaceSsoDomainClaims)
          .where(eq(workspaceSsoDomainClaims.domain, 'retry.test'))
        expect(claim).toMatchObject({
          providerId: 'sso_domain_retry',
          status: 'verified'
        })
      })
    )
  }
)
