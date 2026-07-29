import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '@b2b-saas-starter/db/client'
import { session, user } from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  MessagingWorkspaces,
  MessagingWorkspacesDenied,
  makeMessagingWorkspacesLayer
} from './messaging-workspaces.ts'

const now = new Date('2026-07-30T12:00:00.000Z')
const later = new Date('2026-07-30T20:00:00.000Z')

describe('Operations Messaging workspaces', () => {
  let test: TestD1
  let db: ReturnType<typeof createDb>

  beforeAll(async () => {
    test = await provisionTestD1()
    db = createDb(test.d1)
    await db.insert(user).values([
      {
        id: 'opr_message_reader',
        email: 'reader@operations.test',
        name: 'Messaging Reader',
        emailVerified: true,
        twoFactorEnabled: true,
        identityClass: 'system_operator',
        role: 'messaging-reader',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'opr_message_privileged',
        email: 'privileged@operations.test',
        name: 'Messaging Privileged',
        emailVerified: true,
        twoFactorEnabled: true,
        identityClass: 'system_operator',
        role: 'messaging-controller,messaging-finance,messaging-reconciler,messaging-incident-responder',
        createdAt: now,
        updatedAt: now
      }
    ])
    await db.insert(session).values([
      {
        id: 'ops_message_reader',
        token: 'ops-message-reader',
        userId: 'opr_message_reader',
        expiresAt: later,
        operatorIdleExpiresAt: later,
        operatorAbsoluteExpiresAt: later,
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'ops_message_privileged',
        token: 'ops-message-privileged',
        userId: 'opr_message_privileged',
        expiresAt: later,
        operatorIdleExpiresAt: later,
        operatorAbsoluteExpiresAt: later,
        createdAt: now,
        updatedAt: now
      }
    ])
    for (const statement of [
      `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
       VALUES ('mer_message', 'Northstar Studio', 'northstar', 'UTC', 'EUR', 'solo', '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
       VALUES ('brd_message', 'mer_message', 'Northstar Studio', '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
       VALUES ('shp_message', 'brd_message', 'mer_message', 'northstar', 'Northstar Studio', 'UTC', 'EUR', '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO messaging_rate_cards (id, version, currency, charge_milli_euro, effective_at, notice_published_at, created_at)
       VALUES ('mrcard_message', 91, 'EUR', 45, '2026-06-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', '${now.toISOString()}')`,
      `INSERT INTO notification_intents
       (id, shop_id, topic, recipient_json, payload_json, source_type, source_id, source_version,
        deduplication_key, status, available_at, purpose, phase, created_at, updated_at)
       VALUES ('nti_message', 'shp_message', 'appointment.confirmation', '{}', '{}', 'appointment',
        'apt_message', 1, 'confirmation:apt_message:1', 'processing', '${now.toISOString()}',
        'appointment_confirmation', 'awaiting_provider', '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO protected_messaging_destinations
       (id, shop_id, intent_id, ciphertext, key_version, fingerprint, masked_value, country_code, created_at)
       VALUES ('pmd_message', 'shp_message', 'nti_message', 'secret-destination', 1,
        'sha256:destination-secret', '+40•••••••456', 'RO', '${now.toISOString()}')`,
      `INSERT INTO messaging_balances (shop_id, currency, created_at, updated_at)
       VALUES ('shp_message', 'EUR', '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO messaging_financial_external_facts
       (id, shop_id, kind, provider, source_id, status, amount_milli_euro, currency, reference, observed_at, created_at)
       VALUES ('mff_message', 'shp_message', 'provider_payment', 'stripe', 'pi_message',
        'confirmed', 10000, 'EUR', 'invoice:message', '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO messaging_balance_ledger_entries
       (id, shop_id, direction, kind, amount_milli_euro, currency, source_type, source_id,
        idempotency_key, fiscal_reference, external_fact_id, occurred_at, created_at)
       VALUES ('mle_message', 'shp_message', 'credit', 'top_up', 10000, 'EUR',
        'stripe_payment', 'pi_message', 'stripe:pi_message', 'invoice:message', 'mff_message',
        '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO delivery_routes
       (id, shop_id, intent_id, ordinal, channel, provider, state, accepted_at, delivered_at, created_at, updated_at)
       VALUES ('drt_message', 'shp_message', 'nti_message', 0, 'whatsapp', 'meta', 'delivered',
        '${now.toISOString()}', '${now.toISOString()}', '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO submission_attempts
       (id, shop_id, intent_id, route_id, ordinal, idempotency_key, request_fingerprint, state, started_at, completed_at, created_at)
       VALUES ('pat_message', 'shp_message', 'nti_message', 'drt_message', 0, 'idem-secret',
        'sha256:request-secret', 'accepted', '${now.toISOString()}', '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO provider_evidence
       (id, shop_id, intent_id, route_id, attempt_id, environment, provider, provider_account_key,
        source, source_event_key, provider_reference_fingerprint, status, trusted, normalized_code,
        observed_at, created_at)
       VALUES ('pevd_message', 'shp_message', 'nti_message', 'drt_message', 'pat_message', 'test',
        'meta', 'account-secret', 'callback', 'callback-secret', 'sha256:provider-secret',
        'accepted', 1, 'accepted', '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO messaging_balance_reservations
       (id, shop_id, intent_id, rate_card_id, amount_milli_euro, status, expires_at, converted_at, created_at, updated_at)
       VALUES ('mbr_message', 'shp_message', 'nti_message', 'mrcard_message', 45, 'converted',
        '2026-08-06T12:00:00.000Z', '${now.toISOString()}', '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO messaging_balance_ledger_entries
       (id, shop_id, direction, kind, amount_milli_euro, currency, source_type, source_id,
        idempotency_key, rate_card_id, intent_id, occurred_at, created_at)
       VALUES ('mle_delivery_message', 'shp_message', 'debit', 'delivery_charge', 45, 'EUR',
        'notification_intent', 'nti_message', 'delivery:nti_message', 'mrcard_message',
        'nti_message', '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO chargeable_deliveries
       (id, shop_id, intent_id, reservation_id, rate_card_id, route_id, charge_milli_euro, verified_at, created_at)
       VALUES ('mcd_message', 'shp_message', 'nti_message', 'mbr_message', 'mrcard_message',
        'drt_message', 45, '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO provider_messaging_costs
       (id, shop_id, intent_id, attempt_id, environment, provider, provider_account_key,
        billing_identity_fingerprint, unit_ordinal, amount_minor_units, currency, currency_scale,
        units, source, recorded_at, created_at)
       VALUES ('pmc_message', 'shp_message', 'nti_message', 'pat_message', 'test', 'meta',
        'account-secret', 'sha256:billing-secret', 0, 239, 'EUR', 4, 1, 'invoice',
        '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO messaging_reconciliation_cases
       (id, shop_id, intent_id, kind, source_identity, status, severity, safe_summary, opened_at, created_at, updated_at)
       VALUES ('mrcase_message', 'shp_message', 'nti_message', 'ambiguous_submission',
        'intent:nti_message', 'open', 'high', 'Submission evidence needs review',
        '${now.toISOString()}', '${now.toISOString()}', '${now.toISOString()}')`,
      `INSERT INTO messaging_channel_controls
       (id, environment, channel, provider, enabled, reason, created_at, updated_at)
       VALUES ('mcc_message', 'test', 'whatsapp', 'meta', 1, 'Healthy route', '${now.toISOString()}', '${now.toISOString()}')`
    ])
      await test.d1.prepare(statement).run()
  }, 60_000)

  afterAll(async () => test.dispose())

  const run = <A, E>(
    use: (service: MessagingWorkspaces['Service']) => Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      Effect.flatMap(MessagingWorkspaces, use).pipe(
        Effect.provide(makeMessagingWorkspacesLayer(db, { now: () => now }))
      )
    )

  it('projects a masked cross-Merchant queue and normalized evidence journey', async () => {
    const actor = { operatorSessionId: 'ops_message_reader' }
    const overview = await run((service) => service.overview({ actor, query: '456' }))
    expect(overview.health).toMatchObject({
      openCaseCount: 1,
      ambiguousCount: 1,
      merchantChargeMilliEuro: 45,
      providerCostMilliEuro: 23.9
    })
    expect(overview.cases).toEqual([
      expect.objectContaining({
        caseId: 'mrcase_message',
        merchantName: 'Northstar Studio',
        maskedDestination: '+40•••••••456'
      })
    ])

    const detail = await run((service) =>
      service.caseDetail({ actor, caseId: 'mrcase_message' })
    )
    expect(detail).toMatchObject({
      intent: {
        intentId: 'nti_message',
        purpose: 'appointment_confirmation',
        maskedDestination: '+40•••••••456'
      },
      attempts: [{ attemptId: 'pat_message', state: 'accepted' }],
      evidence: [
        {
          evidenceId: 'pevd_message',
          source: 'callback',
          status: 'accepted',
          trusted: true,
          normalizedCode: 'accepted'
        }
      ],
      reservation: { reservationId: 'mbr_message', amountMilliEuro: 45 },
      reconciliation: { status: 'open', resolutions: [] },
      complaints: []
    })
    const serialized = JSON.stringify({ overview, detail })
    for (const secret of [
      'secret-destination',
      'destination-secret',
      'idem-secret',
      'request-secret',
      'account-secret',
      'callback-secret',
      'provider-secret'
    ])
      expect(serialized).not.toContain(secret)
  })

  it('searches only the allowlisted identities and protected destination suffix', async () => {
    const actor = { operatorSessionId: 'ops_message_reader' }
    for (const query of [
      'nti_message',
      'pat_message',
      'Northstar',
      'mer_message',
      '456'
    ]) {
      await expect(
        run((service) => service.overview({ actor, query }))
      ).resolves.toMatchObject({ cases: [{ caseId: 'mrcase_message' }] })
    }
    for (const query of ['mrcase_message', 'shp_message']) {
      await expect(
        run((service) => service.overview({ actor, query }))
      ).resolves.toMatchObject({ cases: [] })
    }
  })

  it('rechecks each workspace permission independently', async () => {
    const reader = { operatorSessionId: 'ops_message_reader' }
    const privileged = { operatorSessionId: 'ops_message_privileged' }

    await expect(run((service) => service.containment(reader))).rejects.toMatchObject({
      reason: 'messaging:control_required'
    })
    await expect(run((service) => service.finance(reader))).rejects.toMatchObject({
      reason: 'messaging:finance_required'
    })
    await expect(
      run((service) => service.reconciliation(reader))
    ).rejects.toMatchObject({
      reason: 'messaging:reconcile_required'
    })
    await expect(run((service) => service.incidents(reader))).rejects.toMatchObject({
      reason: 'messaging:incident_required'
    })

    await expect(
      run((service) => service.containment(privileged))
    ).resolves.toHaveLength(1)
    const finance = await run((service) => service.finance(privileged))
    expect(finance.rateCards).toContainEqual(
      expect.objectContaining({ rateCardId: 'mrcard_message', chargeMilliEuro: 45 })
    )
    expect(finance.balances).toEqual([
      expect.objectContaining({
        merchantName: 'Northstar Studio',
        postedMilliEuro: 9_955,
        availableMilliEuro: 9_955
      })
    ])
    expect(finance.charges).toEqual([
      expect.objectContaining({ chargeMilliEuro: 45, intentId: 'nti_message' })
    ])
    expect(finance.providerCosts).toEqual([
      expect.objectContaining({ amountMinorUnits: 239, currencyScale: 4 })
    ])
    expect(finance.ledgerEntries).toEqual([
      expect.objectContaining({
        entryId: 'mle_message',
        direction: 'credit',
        reversed: false
      }),
      expect.objectContaining({
        entryId: 'mle_delivery_message',
        direction: 'debit',
        reversed: false
      })
    ])
    await expect(
      run((service) => service.reconciliation(privileged))
    ).resolves.toHaveLength(1)
    await expect(run((service) => service.incidents(privileged))).resolves.toEqual([])
  })

  it('fails closed when the authoritative Operator role changes', async () => {
    await test.d1
      .prepare(
        `UPDATE user SET role = 'merchant-reader' WHERE id = 'opr_message_reader'`
      )
      .run()
    await expect(
      run((service) =>
        service.overview({
          actor: { operatorSessionId: 'ops_message_reader' },
          query: 'nti_message'
        })
      )
    ).rejects.toBeInstanceOf(MessagingWorkspacesDenied)
  })

  it('appends an authorized compensating ledger entry without editing history', async () => {
    const reader = { operatorSessionId: 'ops_message_reader' }
    const privileged = { operatorSessionId: 'ops_message_privileged' }
    const correction = {
      shopId: 'shp_message',
      entryId: 'mle_delivery_message',
      correctionReason: 'invalid_delivery_charge',
      reason: 'Reconciliation proves the delivery was not chargeable',
      confirmed: true
    } as const

    await expect(
      run((service) => service.correctLedgerEntry({ actor: reader, ...correction }))
    ).rejects.toMatchObject({ reason: 'messaging:finance_required' })
    await expect(
      run((service) => service.correctLedgerEntry({ actor: privileged, ...correction }))
    ).resolves.toBeUndefined()

    const finance = await run((service) => service.finance(privileged))
    expect(finance.ledgerEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entryId: 'mle_delivery_message',
          direction: 'debit',
          reversed: true
        }),
        expect.objectContaining({
          kind: 'correction',
          direction: 'credit',
          amountMilliEuro: 45,
          reversed: false
        })
      ])
    )
  })
})
