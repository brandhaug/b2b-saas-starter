import { describe, expect, it } from 'vite-plus/test'
import { provisionTestD1 } from '@b2b-saas-starter/db/testing'
import {
  auditEvents,
  user,
  workspaceMembers,
  workspaces,
  workspaceSsoDomainClaims,
  workspaceSsoRecoveryExceptions
} from '@b2b-saas-starter/db/schema'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { Schema } from 'effect'

import { parseCli, runSsoRecoveryOperator } from './sso-recovery.ts'

const environment = {
  CLOUDFLARE_ACCOUNT_ID: 'account-id',
  CLOUDFLARE_API_TOKEN: 'api-token',
  CLOUDFLARE_DATABASE_ID: 'database-id'
}

function response(results: ReadonlyArray<ReadonlyArray<unknown>>) {
  return new Response(
    JSON.stringify({
      success: true,
      result: results.map((rows) => ({ results: rows }))
    }),
    { status: 200 }
  )
}

const BatchBody = Schema.Struct({
  batch: Schema.Array(
    Schema.Struct({
      sql: Schema.String,
      params: Schema.Array(Schema.String)
    })
  )
})
const decodeBatchBody = Schema.decodeUnknownSync(BatchBody)
const decodeRequestBody = Schema.decodeUnknownSync(Schema.String)

function d1Fetch(d1: Awaited<ReturnType<typeof provisionTestD1>>['d1']) {
  function fetchImpl(_url: URL | RequestInfo, init?: RequestInit) {
    const body = decodeBatchBody(JSON.parse(decodeRequestBody(init?.body)))
    return d1
      .batch(body.batch.map((query) => d1.prepare(query.sql).bind(...query.params)))
      .then((results) => response(results.map((result) => result.results)))
  }
  return fetchImpl
}

async function seedOperatorTarget(
  d1: Awaited<ReturnType<typeof provisionTestD1>>['d1']
) {
  const db = drizzle(d1)
  await db.insert(user).values({
    id: 'usr_owner',
    email: 'owner@example.com',
    name: 'Owner'
  })
  await db.insert(workspaces).values([
    { id: 'wrk_source', slug: 'source', name: 'Source' },
    { id: 'wrk_target', slug: 'target', name: 'Target' }
  ])
  await db.insert(workspaceMembers).values({
    id: 'mem_owner',
    workspaceId: 'wrk_source',
    userId: 'usr_owner',
    role: 'owner'
  })
  return db
}

describe('SSO recovery operator', () => {
  it('requires explicit operator evidence and normalizes domain transfers', () => {
    expect(() => parseCli(['grant', '--workspace', 'wrk', '--owner', 'usr'])).toThrow(
      'Missing --operator <id>'
    )
    expect(
      parseCli([
        'transfer-domain',
        '--domain',
        ' Example.COM. ',
        '--from',
        'wrk_old',
        '--to',
        'wrk_new',
        '--operator',
        'operator@example.com',
        '--reason',
        'support-287'
      ])
    ).toMatchObject({ domain: 'example.com', execute: false })
  })

  it('dry-runs only after confirming the target is an existing owner', async () => {
    const bodies: Array<unknown> = []
    const output: Array<string> = []
    function fetchImpl(_url: URL | RequestInfo, init?: RequestInit) {
      bodies.push(JSON.parse(decodeRequestBody(init?.body)))
      return Promise.resolve(
        response([
          [
            {
              workspace_id: 'wrk_live',
              workspace_slug: 'live-lab',
              user_id: 'usr_owner'
            }
          ]
        ])
      )
    }
    await runSsoRecoveryOperator(
      [
        'grant',
        '--workspace',
        'wrk_live',
        '--owner',
        'usr_owner',
        '--operator',
        'operator@example.com',
        '--reason',
        'support-287'
      ],
      environment,
      fetchImpl,
      (text) => output.push(text)
    )
    expect(bodies).toHaveLength(1)
    expect(output.join('')).toContain('"dryRun": true')
    expect(output.join('')).toContain(
      '/account?repair=sso&workspace=live-lab&exception='
    )
  })

  it('atomically grants an existing owner in real D1', async () => {
    const provisioned = await provisionTestD1()
    try {
      const db = await seedOperatorTarget(provisioned.d1)
      const output: Array<string> = []
      await runSsoRecoveryOperator(
        [
          'grant',
          '--workspace',
          'wrk_source',
          '--owner',
          'usr_owner',
          '--operator',
          'operator@example.com',
          '--reason',
          'support-287',
          '--execute'
        ],
        environment,
        d1Fetch(provisioned.d1),
        (text) => output.push(text)
      )
      const [grant] = await db.select().from(workspaceSsoRecoveryExceptions)
      expect(grant).toMatchObject({
        workspaceId: 'wrk_source',
        userId: 'usr_owner',
        grantedBy: 'operator@example.com',
        usedAt: null,
        sessionId: null
      })
      const matchingAudit = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.targetId, grant?.id ?? 'missing'))
      expect(matchingAudit).toHaveLength(1)
      expect(matchingAudit[0]?.eventType).toBe(
        'workspace_sso.recovery_exception_created'
      )
      expect(output.join('')).toContain('&workspace=source&')
    } finally {
      await provisioned.dispose()
    }
  })

  it('moves a domain claim to pending and audits the old workspace in real D1', async () => {
    const provisioned = await provisionTestD1()
    try {
      const db = await seedOperatorTarget(provisioned.d1)
      await db.insert(workspaceSsoDomainClaims).values({
        id: 'claim_example',
        workspaceId: 'wrk_source',
        domain: 'example.com',
        providerId: 'sso_source',
        verificationTokenHash: 'old-hash',
        status: 'verified',
        verifiedAt: '2026-09-07T10:00:00.000Z',
        createdAt: '2026-09-07T10:00:00.000Z',
        updatedAt: '2026-09-07T10:00:00.000Z'
      })
      await runSsoRecoveryOperator(
        [
          'transfer-domain',
          '--domain',
          'example.com',
          '--from',
          'wrk_source',
          '--to',
          'wrk_target',
          '--operator',
          'operator@example.com',
          '--reason',
          'support-287',
          '--execute'
        ],
        environment,
        d1Fetch(provisioned.d1),
        () => undefined
      )
      const [claim] = await db
        .select()
        .from(workspaceSsoDomainClaims)
        .where(eq(workspaceSsoDomainClaims.id, 'claim_example'))
      expect(claim).toMatchObject({
        workspaceId: 'wrk_target',
        status: 'pending',
        verificationTokenHash: '',
        verifiedAt: null
      })
      const [audit] = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.targetId, 'claim_example'))
      expect(audit).toMatchObject({
        workspaceId: 'wrk_source',
        eventType: 'workspace_sso.domain_transferred'
      })
    } finally {
      await provisioned.dispose()
    }
  })
})
