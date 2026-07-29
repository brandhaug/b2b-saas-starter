import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '@b2b-saas-starter/db/client'
import { session, user } from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  MessagingGovernance,
  MessagingGovernanceDenied,
  makeMessagingGovernanceLayer
} from './messaging-governance.ts'

const now = new Date('2026-07-29T12:00:00.000Z')
const later = new Date('2026-07-29T20:00:00.000Z')

describe('Operations Messaging governance', () => {
  let test: TestD1
  let db: ReturnType<typeof createDb>

  beforeAll(async () => {
    test = await provisionTestD1()
    db = createDb(test.d1)
    await db.insert(user).values([
      {
        id: 'opr_governance_a',
        email: 'governance-a@operations.test',
        name: 'Governance A',
        emailVerified: true,
        twoFactorEnabled: true,
        identityClass: 'system_operator',
        role: 'messaging-incident-responder,messaging-controller,messaging-reconciler',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'opr_governance_b',
        email: 'governance-b@operations.test',
        name: 'Governance B',
        emailVerified: true,
        twoFactorEnabled: true,
        identityClass: 'system_operator',
        role: 'messaging-controller',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'mem_governance',
        email: 'merchant@governance.test',
        name: 'Merchant',
        emailVerified: true,
        identityClass: 'merchant_member',
        role: 'messaging-controller',
        createdAt: now,
        updatedAt: now
      }
    ])
    await db.insert(session).values([
      {
        id: 'ops_governance_a',
        token: 'ops-governance-a',
        userId: 'opr_governance_a',
        expiresAt: later,
        operatorIdleExpiresAt: later,
        operatorAbsoluteExpiresAt: later,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'ops_governance_b',
        token: 'ops-governance-b',
        userId: 'opr_governance_b',
        expiresAt: later,
        operatorIdleExpiresAt: later,
        operatorAbsoluteExpiresAt: later,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'merchant_impersonated_governance',
        token: 'merchant-impersonated-governance',
        userId: 'mem_governance',
        impersonatedBy: 'opr_governance_a',
        expiresAt: later,
        createdAt: now,
        updatedAt: now
      }
    ])
    for (const statement of [
      `INSERT INTO messaging_channel_controls
       (id, environment, channel, provider, enabled, created_at, updated_at)
       VALUES ('mcc_governance_meta', 'test', 'whatsapp', 'meta', 1, '${now.toISOString()}', '${now.toISOString()}'),
              ('mcc_governance_smso', 'test', 'sms', 'smso', 1, '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO messaging_reconciliation_cases
       (id, kind, source_identity, status, severity, safe_summary, opened_at, created_at, updated_at)
       VALUES ('mrcase_governance', 'invoice_mismatch', 'invoice:governance', 'open',
        'high', 'Invoice evidence needs review', '${now.toISOString()}',
        '${now.toISOString()}', '${now.toISOString()}')`
    ])
      await test.d1.prepare(statement).run()
  }, 60_000)

  afterAll(async () => test.dispose())

  const run = <A, E>(
    use: (service: MessagingGovernance['Service']) => Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      Effect.flatMap(MessagingGovernance, use).pipe(
        Effect.provide(makeMessagingGovernanceLayer(db, { now: () => now }))
      )
    )

  const actorA = { operatorSessionId: 'ops_governance_a' }
  const actorB = { operatorSessionId: 'ops_governance_b' }

  it('denies impersonation and broader-than-needed containment', async () => {
    await expect(
      run((service) =>
        service.openIncident({
          actor: { operatorSessionId: 'merchant_impersonated_governance' },
          kind: 'credential_compromise',
          severity: 'critical',
          safeSummary: 'Provider credential requires containment',
          containmentScope: 'provider_channel',
          environment: 'test',
          provider: 'meta',
          channel: 'whatsapp',
          reason: 'Credential exposure was reported by the provider'
        })
      )
    ).rejects.toBeInstanceOf(MessagingGovernanceDenied)

    await expect(
      run((service) =>
        service.openIncident({
          actor: actorA,
          kind: 'duplicate_delivery',
          severity: 'critical',
          safeSummary: 'Duplicate delivery is under investigation',
          containmentScope: 'global',
          environment: 'test',
          reason: 'One intent produced two provider delivery facts'
        })
      )
    ).rejects.toMatchObject({ reason: 'containment_scope_too_broad' })
  })

  it('requires two distinct current Operators before a global re-enable', async () => {
    const incident = await run((service) =>
      service.openIncident({
        actor: actorA,
        kind: 'platform_integrity',
        severity: 'critical',
        safeSummary: 'Global routing integrity is untrusted',
        containmentScope: 'global',
        environment: 'test',
        reason: 'Cross-provider integrity probes failed'
      })
    )
    await run((service) =>
      service.contain({
        actor: actorA,
        incidentId: incident.incidentId,
        reason: 'Stop submissions until reconciliation completes',
        confirmed: true
      })
    )
    await run((service) =>
      service.recordRecoveryCheck({
        actor: actorA,
        incidentId: incident.incidentId,
        kind: 'health_probe',
        reference: 'probe:governance:1',
        status: 'passed',
        observedAt: now.toISOString(),
        reason: 'All routing health probes passed after containment'
      })
    )
    await run((service) =>
      service.recordRecoveryCheck({
        actor: actorA,
        incidentId: incident.incidentId,
        kind: 'reconciliation',
        reference: 'reconciliation:governance:1',
        status: 'passed',
        observedAt: now.toISOString(),
        reason: 'Daily financial and delivery reconciliation passed'
      })
    )
    await run((service) =>
      service.approveRecovery({
        actor: actorA,
        incidentId: incident.incidentId,
        reason: 'First recovery review completed',
        healthProbeReference: 'probe:governance:1',
        reconciliationReference: 'reconciliation:governance:1',
        residualRisk: 'Low residual retry risk'
      })
    )
    await expect(
      run((service) =>
        service.completeRecovery({
          actor: actorA,
          incidentId: incident.incidentId,
          reason: 'Attempting recovery after one approval',
          confirmed: true
        })
      )
    ).rejects.toMatchObject({ reason: 'two_person_approval_required' })
    await run((service) =>
      service.approveRecovery({
        actor: actorB,
        incidentId: incident.incidentId,
        reason: 'Independent recovery review completed',
        healthProbeReference: 'probe:governance:1',
        reconciliationReference: 'reconciliation:governance:1',
        residualRisk: 'Low residual retry risk'
      })
    )
    await db.update(user).set({ banned: true }).where(eq(user.id, 'opr_governance_b'))
    await expect(
      run((service) =>
        service.completeRecovery({
          actor: actorA,
          incidentId: incident.incidentId,
          reason: 'A stale second approval cannot restore routing',
          confirmed: true
        })
      )
    ).rejects.toMatchObject({ reason: 'two_person_approval_required' })
    await db.update(user).set({ banned: false }).where(eq(user.id, 'opr_governance_b'))
    await run((service) =>
      service.completeRecovery({
        actor: actorA,
        incidentId: incident.incidentId,
        reason: 'Two reviews complete and probes are healthy',
        confirmed: true
      })
    )

    const controls = await test.d1
      .prepare(
        `SELECT enabled FROM messaging_channel_controls WHERE environment = 'test'`
      )
      .all<{ enabled: number }>()
    expect(controls.results.map((row) => row.enabled)).toEqual([1, 1])
  })

  it('requires verified credential rotation before provider recovery', async () => {
    const incident = await run((service) =>
      service.openIncident({
        actor: actorA,
        kind: 'credential_compromise',
        severity: 'critical',
        safeSummary: 'Meta provider credential is compromised',
        containmentScope: 'provider_channel',
        environment: 'test',
        provider: 'meta',
        channel: 'whatsapp',
        reason: 'Provider credential appeared in an unauthorized system'
      })
    )
    await run((service) =>
      service.contain({
        actor: actorA,
        incidentId: incident.incidentId,
        reason: 'Disable only the affected provider route immediately',
        confirmed: true
      })
    )
    for (const [kind, reference] of [
      ['health_probe', 'probe:credential:1'],
      ['reconciliation', 'reconciliation:credential:1']
    ] as const)
      await run((service) =>
        service.recordRecoveryCheck({
          actor: actorA,
          incidentId: incident.incidentId,
          kind,
          reference,
          status: 'passed',
          observedAt: now.toISOString(),
          reason: 'Credential incident recovery evidence passed review'
        })
      )
    const approval = {
      incidentId: incident.incidentId,
      reason: 'Credential recovery evidence is independently reviewed',
      healthProbeReference: 'probe:credential:1',
      reconciliationReference: 'reconciliation:credential:1',
      residualRisk: 'Provider propagation delay remains monitored'
    }
    await expect(
      run((service) => service.approveRecovery({ actor: actorA, ...approval }))
    ).rejects.toMatchObject({ reason: 'verified_key_rotation_required' })
    await run((service) =>
      service.recordKeyRotation({
        actor: actorA,
        incidentId: incident.incidentId,
        kind: 'provider_credential',
        previousVersion: 'meta-v1',
        nextVersion: 'meta-v2',
        invalidatedAt: now.toISOString(),
        validatedAt: now.toISOString(),
        evidenceReference: 'vault-rotation:meta-v2',
        reason: 'Old credential revoked and replacement probe succeeded'
      })
    )
    await run((service) => service.approveRecovery({ actor: actorA, ...approval }))
    await run((service) => service.approveRecovery({ actor: actorB, ...approval }))
    await run((service) =>
      service.completeRecovery({
        actor: actorA,
        incidentId: incident.incidentId,
        reason: 'Two current Operators verified rotation and recovery',
        confirmed: true
      })
    )
  })

  it('contains forged callbacks without disabling outbound delivery', async () => {
    const incident = await run((service) =>
      service.openIncident({
        actor: actorA,
        kind: 'forged_callback',
        severity: 'high',
        safeSummary: 'SMS callback authentication cannot be trusted',
        containmentScope: 'callback_rule',
        environment: 'test',
        provider: 'smso',
        channel: 'sms',
        reason: 'Callback traffic contains evidence of forged provider facts'
      })
    )
    await run((service) =>
      service.contain({
        actor: actorA,
        incidentId: incident.incidentId,
        reason: 'Reject only SMSO callbacks while polling remains authoritative',
        confirmed: true
      })
    )
    const rule = await test.d1
      .prepare(
        `SELECT enabled FROM messaging_callback_rejection_rules
         WHERE environment = 'test' AND provider = 'smso' AND rule_key = 'sms'`
      )
      .first()
    const channel = await test.d1
      .prepare(
        `SELECT enabled FROM messaging_channel_controls
         WHERE environment = 'test' AND provider = 'smso' AND channel = 'sms'`
      )
      .first()
    expect(rule).toMatchObject({ enabled: 1 })
    expect(channel).toMatchObject({ enabled: 1 })
  })

  it('places and releases an exact retention hold with governance audit', async () => {
    const holdId = await run((service) =>
      service.placeRetentionHold({
        actor: actorA,
        resourceType: 'notification_destination',
        resourceId: 'ndst_governance_exact',
        purpose: 'active_legal_request',
        reason: 'Preserve this exact destination for a legal request'
      })
    )
    await run((service) =>
      service.releaseRetentionHold({
        actor: actorA,
        holdId,
        reason: 'Legal request closed and preservation is no longer needed'
      })
    )
    const hold = await test.d1
      .prepare(
        `SELECT status, released_by_operator_id FROM messaging_retention_holds WHERE id = ?`
      )
      .bind(holdId)
      .first()
    expect(hold).toMatchObject({
      status: 'released',
      released_by_operator_id: 'opr_governance_a'
    })
  })

  it('appends a reconciliation resolution and governance audit atomically', async () => {
    await run((service) =>
      service.resolveCase({
        actor: actorA,
        caseId: 'mrcase_governance',
        disposition: 'resolved',
        classification: 'provider_invoice_corrected',
        source: 'invoice:governance:corrected',
        reason: 'Corrected provider invoice now matches cost evidence'
      })
    )

    const resolution = await test.d1
      .prepare(
        `SELECT disposition, actor_operator_id FROM messaging_reconciliation_resolutions
         WHERE case_id = 'mrcase_governance'`
      )
      .first()
    const audit = await test.d1
      .prepare(
        `SELECT event_type FROM audit_events
         WHERE target_id = 'mrcase_governance' AND event_type = 'messaging.reconciliation.resolved'`
      )
      .first()
    expect(resolution).toMatchObject({
      disposition: 'resolved',
      actor_operator_id: 'opr_governance_a'
    })
    expect(audit).toMatchObject({ event_type: 'messaging.reconciliation.resolved' })
  })
})
