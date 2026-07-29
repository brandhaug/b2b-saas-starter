import { Context, Effect, Layer, Schema } from 'effect'
import { Database } from '@b2b-saas-starter/db'

const day = 24 * 60 * 60 * 1_000
const before = (now: string, duration: number) =>
  new Date(new Date(now).getTime() - duration).toISOString()
const after = (now: string, duration: number) =>
  new Date(new Date(now).getTime() + duration).toISOString()
const utcDayStart = (now: string) => {
  const value = new Date(now)
  value.setUTCHours(0, 0, 0, 0)
  return value.toISOString()
}

export class OperationalMessagingJobUnavailable extends Schema.TaggedErrorClass<OperationalMessagingJobUnavailable>()(
  'OperationalMessagingJobUnavailable',
  { operation: Schema.String, reason: Schema.String }
) {}

export const OperationalMessagingReconciliationResult = Schema.Struct({
  inspected: Schema.Int,
  ambiguityAlertsOpened: Schema.Int,
  ambiguitiesClosed: Schema.Int,
  duplicateDeliveryCasesOpened: Schema.Int,
  financialCasesOpened: Schema.Int,
  merchantsFinanciallyFrozen: Schema.Int
})

export const OperationalMessagingRetentionResult = Schema.Struct({
  inspected: Schema.Int,
  completed: Schema.Int,
  failed: Schema.Int
})

type JobError = OperationalMessagingJobUnavailable
type ReconciliationResult = typeof OperationalMessagingReconciliationResult.Type
type RetentionResult = typeof OperationalMessagingRetentionResult.Type

export type OperationalMessagingJobsShape = {
  readonly reconcile: (input: {
    readonly now: string
    readonly ownerId: string
    readonly limit: number
  }) => Effect.Effect<ReconciliationResult, JobError>
  readonly scheduleRetention: (input: {
    readonly now: string
    readonly shopId?: string
    readonly limit: number
  }) => Effect.Effect<number, JobError>
  readonly schedulePrivacyDeletion: (input: {
    readonly now: string
    readonly shopId: string
  }) => Effect.Effect<number, JobError>
  readonly processRetention: (input: {
    readonly now: string
    readonly ownerId: string
    readonly limit: number
  }) => Effect.Effect<RetentionResult, JobError>
}

export class OperationalMessagingJobs extends Context.Service<
  OperationalMessagingJobs,
  OperationalMessagingJobsShape
>()('@b2b-saas-starter/capabilities/notifications/OperationalMessagingJobs') {}

type UnknownRouteRow = {
  id: string
  shop_id: string
  intent_id: string
  updated_at: string
}

type DuplicateDeliveryRow = {
  intent_id: string
  shop_id: string
}

type FinancialMismatchRow = {
  shop_id: string
  intent_id: string | null
  kind: string
  source_identity: string
  safe_summary: string
}

type RetentionCandidateRow = {
  id: string
  shop_id: string
  intent_id: string
}

type ProviderReferenceRetentionRow = {
  id: string
  shop_id: string
}

type ControlledFactsRetentionRow = {
  intent_id: string
  shop_id: string
}

type QuarantineRetentionRow = {
  id: string
}

type TombstoneRow = {
  id: string
  resource_type: string
  resource_id: string
  action:
    | 'erase_destination'
    | 'erase_provider_reference'
    | 'erase_facts'
    | 'delete_quarantine'
}

const unavailable = (operation: string) => (cause: unknown) =>
  new OperationalMessagingJobUnavailable({
    operation,
    reason: cause instanceof Error ? cause.message : String(cause)
  })

const validLimit = (limit: number) =>
  Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 100

const stableId = async (prefix: string, identity: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(identity)
  )
  const key = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return `${prefix}_${key.slice(0, 32)}`
}

export const LiveOperationalMessagingJobs: Layer.Layer<
  OperationalMessagingJobs,
  never,
  Database
> = Layer.effect(
  OperationalMessagingJobs,
  Effect.gen(function* () {
    const db = yield* Database
    const raw = db.$client.config.db

    const reconcile = (input: {
      readonly now: string
      readonly ownerId: string
      readonly limit: number
    }) =>
      Effect.tryPromise({
        try: async (): Promise<ReconciliationResult> => {
          const limit = validLimit(input.limit)
          const alertCutoff = before(input.now, day)
          const closureCutoff = before(input.now, 7 * day)
          const alertRows = await raw
            .prepare(
              `SELECT id, shop_id, intent_id, updated_at
               FROM delivery_routes dr
               WHERE state = 'submission_unknown' AND updated_at <= ?
                 AND NOT EXISTS (
                   SELECT 1 FROM messaging_reconciliation_cases mrc
                   WHERE mrc.kind = 'submission_ambiguity'
                     AND mrc.source_identity = 'route:' || dr.id
                 )
               ORDER BY updated_at, id LIMIT ?`
            )
            .bind(alertCutoff, limit)
            .all<UnknownRouteRow>()
          const closureRows = await raw
            .prepare(
              `SELECT id, shop_id, intent_id, updated_at
               FROM delivery_routes
               WHERE state = 'submission_unknown' AND updated_at <= ?
               ORDER BY updated_at, id LIMIT ?`
            )
            .bind(closureCutoff, limit)
            .all<UnknownRouteRow>()
          const unknowns = [
            ...new Map(
              [...alertRows.results, ...closureRows.results].map((row) => [row.id, row])
            ).values()
          ]

          let ambiguityAlertsOpened = 0
          let ambiguitiesClosed = 0
          for (const route of unknowns) {
            const leaseToken = `mjob_${crypto.randomUUID()}`
            const leasedUntil = after(input.now, 5 * 60 * 1_000)
            await raw
              .prepare(
                `INSERT OR IGNORE INTO notification_intent_leases
                 (intent_id, shop_id, owner_id, lease_token, leased_until, attempt_count,
                  last_recovered_at, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
              )
              .bind(
                route.intent_id,
                route.shop_id,
                input.ownerId,
                leaseToken,
                leasedUntil,
                input.now,
                input.now,
                input.now
              )
              .run()
            await raw
              .prepare(
                `UPDATE notification_intent_leases
                 SET owner_id = ?, lease_token = ?, leased_until = ?,
                     attempt_count = attempt_count + 1, last_recovered_at = ?, updated_at = ?
                 WHERE intent_id = ? AND leased_until <= ?`
              )
              .bind(
                input.ownerId,
                leaseToken,
                leasedUntil,
                input.now,
                input.now,
                route.intent_id,
                input.now
              )
              .run()
            const lease = await raw
              .prepare(
                `SELECT lease_token FROM notification_intent_leases
                 WHERE intent_id = ? AND owner_id = ? AND lease_token = ?`
              )
              .bind(route.intent_id, input.ownerId, leaseToken)
              .first<{ lease_token: string }>()
            if (!lease) continue
            const caseResult = await raw
              .prepare(
                `INSERT OR IGNORE INTO messaging_reconciliation_cases
                 (id, shop_id, intent_id, kind, source_identity, status, severity,
                  safe_summary, opened_at, created_at, updated_at)
                 VALUES (?, ?, ?, 'submission_ambiguity', ?, 'open', 'high',
                  'Provider submission remains unconfirmed', ?, ?, ?)`
              )
              .bind(
                `mrcase_ambiguity_${route.id}`,
                route.shop_id,
                route.intent_id,
                `route:${route.id}`,
                input.now,
                input.now,
                input.now
              )
              .run()
            ambiguityAlertsOpened += caseResult.meta.changes ?? 0
            if (route.updated_at > closureCutoff) {
              await raw
                .prepare(
                  `DELETE FROM notification_intent_leases
                   WHERE intent_id = ? AND lease_token = ?`
                )
                .bind(route.intent_id, leaseToken)
                .run()
              continue
            }

            const results = await raw.batch([
              raw
                .prepare(
                  `UPDATE notification_intents
                   SET phase = 'terminal', result = 'delivery_failed',
                       result_reason = 'delivery_unconfirmed', terminal_at = ?,
                       status = 'failed', updated_at = ?
                   WHERE id = ? AND phase <> 'terminal'`
                )
                .bind(input.now, input.now, route.intent_id),
              raw
                .prepare(
                  `UPDATE delivery_routes
                   SET state = 'terminal_failure', terminal_at = COALESCE(terminal_at, ?),
                       updated_at = ?
                   WHERE id = ? AND state = 'submission_unknown'`
                )
                .bind(input.now, input.now, route.id),
              raw
                .prepare(
                  `UPDATE messaging_balance_reservations
                   SET status = 'released', released_at = ?,
                       release_reason = 'ambiguity_timeout', updated_at = ?
                   WHERE intent_id = ? AND status = 'active'`
                )
                .bind(input.now, input.now, route.intent_id),
              raw
                .prepare(
                  `DELETE FROM notification_intent_leases
                   WHERE intent_id = ? AND lease_token = ?`
                )
                .bind(route.intent_id, leaseToken)
            ])
            ambiguitiesClosed += results[0]?.meta.changes ?? 0
          }

          const dailyCursor = utcDayStart(input.now)
          await raw
            .prepare(
              `INSERT OR IGNORE INTO messaging_job_cursors
               (job_name, cursor_value, lease_owner, leased_until, updated_at)
               VALUES ('daily-operational-messaging-reconciliation', '', NULL, NULL, ?)`
            )
            .bind(input.now)
            .run()
          await raw
            .prepare(
              `UPDATE messaging_job_cursors
               SET lease_owner = ?, leased_until = ?, updated_at = ?
               WHERE job_name = 'daily-operational-messaging-reconciliation'
                 AND cursor_value < ?
                 AND (lease_owner IS NULL OR leased_until <= ?)`
            )
            .bind(
              input.ownerId,
              after(input.now, 5 * 60 * 1_000),
              input.now,
              dailyCursor,
              input.now
            )
            .run()
          const dailyLease = await raw
            .prepare(
              `SELECT lease_owner FROM messaging_job_cursors
               WHERE job_name = 'daily-operational-messaging-reconciliation'
                 AND lease_owner = ? AND cursor_value < ?`
            )
            .bind(input.ownerId, dailyCursor)
            .first<{ lease_owner: string }>()
          const duplicateRows = dailyLease
            ? await raw
                .prepare(
                  `SELECT dr.intent_id, dr.shop_id
                   FROM delivery_routes dr
                   WHERE dr.state = 'delivered'
                     AND NOT EXISTS (
                       SELECT 1 FROM messaging_reconciliation_cases mrc
                       WHERE mrc.kind = 'duplicate_delivery'
                         AND mrc.source_identity = 'intent:' || dr.intent_id
                     )
                   GROUP BY dr.intent_id, dr.shop_id HAVING COUNT(*) > 1
                   ORDER BY dr.intent_id`
                )
                .all<DuplicateDeliveryRow>()
            : { results: [] as DuplicateDeliveryRow[] }
          let duplicateDeliveryCasesOpened = 0
          for (const row of duplicateRows.results) {
            const result = await raw
              .prepare(
                `INSERT OR IGNORE INTO messaging_reconciliation_cases
                 (id, shop_id, intent_id, kind, source_identity, status, severity,
                  safe_summary, opened_at, created_at, updated_at)
                 VALUES (?, ?, ?, 'duplicate_delivery', ?, 'open', 'critical',
                  'More than one provider route reports delivery', ?, ?, ?)`
              )
              .bind(
                `mrcase_duplicate_${row.intent_id}`,
                row.shop_id,
                row.intent_id,
                `intent:${row.intent_id}`,
                input.now,
                input.now,
                input.now
              )
              .run()
            duplicateDeliveryCasesOpened += result.meta.changes ?? 0
          }

          const financialQueries = [
            `SELECT cd.shop_id, cd.intent_id, 'missing_charge' AS kind,
                    'intent:' || cd.intent_id || ':missing_charge' AS source_identity,
                    'A Chargeable Delivery has no matching ledger charge' AS safe_summary
             FROM chargeable_deliveries cd
             WHERE NOT EXISTS (
               SELECT 1 FROM messaging_balance_ledger_entries mle
               WHERE mle.intent_id = cd.intent_id AND mle.kind = 'delivery_charge'
             )`,
            `SELECT mle.shop_id, mle.intent_id, 'charge_without_delivery' AS kind,
                    'ledger:' || mle.id || ':charge_without_delivery' AS source_identity,
                    'A delivery charge has no Chargeable Delivery' AS safe_summary
             FROM messaging_balance_ledger_entries mle
             WHERE mle.kind = 'delivery_charge' AND NOT EXISTS (
               SELECT 1 FROM chargeable_deliveries cd WHERE cd.intent_id = mle.intent_id
             )`,
            `SELECT mbr.shop_id, mbr.intent_id, 'terminal_active_reservation' AS kind,
                    'reservation:' || mbr.id || ':terminal_active' AS source_identity,
                    'A terminal intent still holds an active reservation' AS safe_summary
             FROM messaging_balance_reservations mbr
             JOIN notification_intents ni ON ni.id = mbr.intent_id
             WHERE mbr.status = 'active' AND ni.phase = 'terminal'`,
            `SELECT mff.shop_id, NULL AS intent_id, 'external_fact_without_ledger' AS kind,
                    'external-fact:' || mff.id || ':missing_ledger' AS source_identity,
                    'A confirmed payment or refund has no ledger entry' AS safe_summary
             FROM messaging_financial_external_facts mff
             WHERE mff.kind IN ('provider_payment', 'provider_refund')
               AND mff.status = 'confirmed' AND NOT EXISTS (
                 SELECT 1 FROM messaging_balance_ledger_entries mle
                 WHERE mle.external_fact_id = mff.id
               )`,
            `SELECT mff.shop_id, NULL AS intent_id,
                    'fiscal_fact_without_ledger_reference' AS kind,
                    'external-fact:' || mff.id || ':missing_fiscal_link' AS source_identity,
                    'An issued fiscal fact has no linked ledger reference' AS safe_summary
             FROM messaging_financial_external_facts mff
             WHERE mff.kind IN ('invoice', 'credit_note', 'efactura')
               AND mff.status IN ('issued', 'submitted', 'accepted')
               AND mff.reference IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM messaging_balance_ledger_entries mle
                 WHERE mle.shop_id = mff.shop_id AND mle.fiscal_reference = mff.reference
               )`,
            `SELECT mbs.shop_id, NULL AS intent_id, 'untrusted_displayed_balance' AS kind,
                    'balance:' || mbs.shop_id || ':negative_projection' AS source_identity,
                    'The displayed Messaging Balance violates conservation' AS safe_summary
             FROM merchant_messaging_balance_summaries mbs
             WHERE mbs.posted_milli_euro < 0 OR mbs.reserved_milli_euro < 0
                OR mbs.available_milli_euro < 0`,
            `SELECT pmc.shop_id, pmc.intent_id, 'provider_cost_without_evidence' AS kind,
                    'provider-cost:' || pmc.id || ':missing_evidence' AS source_identity,
                    'A provider cost has no matching Provider Evidence' AS safe_summary
             FROM provider_messaging_costs pmc
             WHERE NOT EXISTS (
               SELECT 1 FROM provider_evidence pe WHERE pe.attempt_id = pmc.attempt_id
             )`,
            `SELECT cd.shop_id, cd.intent_id, 'chargeable_route_not_delivered' AS kind,
                    'delivery:' || cd.id || ':route_not_delivered' AS source_identity,
                    'A Chargeable Delivery route is not projected Delivered' AS safe_summary
             FROM chargeable_deliveries cd
             JOIN delivery_routes dr ON dr.id = cd.route_id
             WHERE dr.state <> 'delivered'`
          ]
          const financialRows = {
            results: dailyLease
              ? (
                  await Promise.all(
                    financialQueries.map((query) =>
                      raw.prepare(query).all<FinancialMismatchRow>()
                    )
                  )
                ).flatMap((result) => result.results)
              : ([] as FinancialMismatchRow[])
          }
          let financialCasesOpened = 0
          const frozen = new Set<string>()
          for (const row of financialRows.results) {
            const results = await raw.batch([
              raw
                .prepare(
                  `INSERT OR IGNORE INTO messaging_reconciliation_cases
                   (id, shop_id, intent_id, kind, source_identity, status, severity,
                    safe_summary, opened_at, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'open', 'critical', ?, ?, ?, ?)`
                )
                .bind(
                  await stableId('mrcase_finance', row.source_identity),
                  row.shop_id,
                  row.intent_id,
                  row.kind,
                  row.source_identity,
                  row.safe_summary,
                  input.now,
                  input.now,
                  input.now
                ),
              raw
                .prepare(
                  `UPDATE messaging_balances
                   SET financially_frozen = 1, freeze_reason = 'reconciliation_required',
                       updated_at = ?
                   WHERE shop_id = ? AND financially_frozen = 0`
                )
                .bind(input.now, row.shop_id)
            ])
            financialCasesOpened += results[0]?.meta.changes ?? 0
            if ((results[1]?.meta.changes ?? 0) > 0) frozen.add(row.shop_id)
          }
          if (dailyLease)
            await raw
              .prepare(
                `UPDATE messaging_job_cursors
                 SET cursor_value = ?, lease_owner = NULL, leased_until = NULL,
                     updated_at = ?
                 WHERE job_name = 'daily-operational-messaging-reconciliation'
                   AND lease_owner = ?`
              )
              .bind(input.now, input.now, input.ownerId)
              .run()

          return {
            inspected:
              unknowns.length +
              duplicateRows.results.length +
              financialRows.results.length,
            ambiguityAlertsOpened,
            ambiguitiesClosed,
            duplicateDeliveryCasesOpened,
            financialCasesOpened,
            merchantsFinanciallyFrozen: frozen.size
          }
        },
        catch: unavailable('reconcile')
      })

    const scheduleRetention = (input: {
      readonly now: string
      readonly shopId?: string
      readonly limit: number
    }) =>
      Effect.tryPromise({
        try: async () => {
          const cutoff = before(input.now, 30 * day)
          const candidates = await raw
            .prepare(
              `SELECT pmd.id, pmd.shop_id, pmd.intent_id
               FROM protected_messaging_destinations pmd
               JOIN notification_intents ni ON ni.id = pmd.intent_id
               WHERE pmd.erased_at IS NULL AND ni.terminal_at IS NOT NULL
                 AND ni.terminal_at <= ? AND (? IS NULL OR pmd.shop_id = ?)
                 AND NOT EXISTS (
                   SELECT 1 FROM messaging_retention_tombstones mrt
                   WHERE mrt.resource_type = 'protected_messaging_destination'
                     AND mrt.resource_id = pmd.id AND mrt.action = 'erase_destination'
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM messaging_retention_holds mrh
                   WHERE mrh.resource_type = 'protected_messaging_destination'
                     AND mrh.resource_id = pmd.id AND mrh.status = 'active'
                 )
               ORDER BY ni.terminal_at, pmd.id LIMIT ?`
            )
            .bind(
              cutoff,
              input.shopId ?? null,
              input.shopId ?? null,
              validLimit(input.limit)
            )
            .all<RetentionCandidateRow>()
          let scheduled = 0
          for (const candidate of candidates.results) {
            const result = await raw
              .prepare(
                `INSERT OR IGNORE INTO messaging_retention_tombstones
                 (id, shop_id, resource_type, resource_id, action, status, due_at,
                  attempt_count, created_at, updated_at)
                 VALUES (?, ?, 'protected_messaging_destination', ?, 'erase_destination',
                  'pending', ?, 0, ?, ?)`
              )
              .bind(
                `mrt_destination_${candidate.id}`,
                candidate.shop_id,
                candidate.id,
                input.now,
                input.now,
                input.now
              )
              .run()
            scheduled += result.meta.changes ?? 0
          }
          const evidenceCutoff = before(input.now, 180 * day)
          const references = await raw
            .prepare(
              `SELECT ppr.id, ppr.shop_id
               FROM protected_provider_references ppr
               JOIN submission_attempts sa ON sa.id = ppr.attempt_id
               JOIN notification_intents ni ON ni.id = sa.intent_id
               WHERE ppr.erased_at IS NULL AND ni.terminal_at IS NOT NULL
                 AND ni.terminal_at <= ? AND (? IS NULL OR ppr.shop_id = ?)
                 AND NOT EXISTS (
                   SELECT 1 FROM messaging_retention_tombstones mrt
                   WHERE mrt.resource_type = 'protected_provider_reference'
                     AND mrt.resource_id = ppr.id
                     AND mrt.action = 'erase_provider_reference'
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM messaging_retention_holds mrh
                   WHERE mrh.resource_type = 'protected_provider_reference'
                     AND mrh.resource_id = ppr.id AND mrh.status = 'active'
                 )
               ORDER BY ni.terminal_at, ppr.id LIMIT ?`
            )
            .bind(
              evidenceCutoff,
              input.shopId ?? null,
              input.shopId ?? null,
              validLimit(input.limit)
            )
            .all<ProviderReferenceRetentionRow>()
          for (const reference of references.results) {
            const result = await raw
              .prepare(
                `INSERT OR IGNORE INTO messaging_retention_tombstones
                 (id, shop_id, resource_type, resource_id, action, status, due_at,
                  attempt_count, created_at, updated_at)
                 VALUES (?, ?, 'protected_provider_reference', ?,
                  'erase_provider_reference', 'pending', ?, 0, ?, ?)`
              )
              .bind(
                `mrt_provider_reference_${reference.id}`,
                reference.shop_id,
                reference.id,
                input.now,
                input.now,
                input.now
              )
              .run()
            scheduled += result.meta.changes ?? 0
          }
          const facts = await raw
            .prepare(
              `SELECT nicf.intent_id, nicf.shop_id
               FROM notification_intent_controlled_facts nicf
               JOIN notification_intents ni ON ni.id = nicf.intent_id
               WHERE nicf.erased_at IS NULL AND ni.terminal_at IS NOT NULL
                 AND ni.terminal_at <= ? AND (? IS NULL OR nicf.shop_id = ?)
                 AND NOT EXISTS (
                   SELECT 1 FROM messaging_retention_tombstones mrt
                   WHERE mrt.resource_type = 'notification_intent_controlled_facts'
                     AND mrt.resource_id = nicf.intent_id AND mrt.action = 'erase_facts'
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM messaging_retention_holds mrh
                   WHERE mrh.resource_type = 'notification_intent_controlled_facts'
                     AND mrh.resource_id = nicf.intent_id AND mrh.status = 'active'
                 )
               ORDER BY ni.terminal_at, nicf.intent_id LIMIT ?`
            )
            .bind(
              evidenceCutoff,
              input.shopId ?? null,
              input.shopId ?? null,
              validLimit(input.limit)
            )
            .all<ControlledFactsRetentionRow>()
          for (const fact of facts.results) {
            const result = await raw
              .prepare(
                `INSERT OR IGNORE INTO messaging_retention_tombstones
                 (id, shop_id, resource_type, resource_id, action, status, due_at,
                  attempt_count, created_at, updated_at)
                 VALUES (?, ?, 'notification_intent_controlled_facts', ?, 'erase_facts',
                  'pending', ?, 0, ?, ?)`
              )
              .bind(
                `mrt_controlled_facts_${fact.intent_id}`,
                fact.shop_id,
                fact.intent_id,
                input.now,
                input.now,
                input.now
              )
              .run()
            scheduled += result.meta.changes ?? 0
          }
          const quarantine = await raw
            .prepare(
              `SELECT id FROM messaging_incident_quarantine
               WHERE expires_at <= ?
                 AND NOT EXISTS (
                   SELECT 1 FROM messaging_retention_tombstones mrt
                   WHERE mrt.resource_type = 'incident_quarantine'
                     AND mrt.resource_id = messaging_incident_quarantine.id
                     AND mrt.action = 'delete_quarantine'
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM messaging_retention_holds mrh
                   WHERE mrh.resource_type = 'incident_quarantine'
                     AND mrh.resource_id = messaging_incident_quarantine.id
                     AND mrh.status = 'active'
                 )
               ORDER BY expires_at, id LIMIT ?`
            )
            .bind(input.now, validLimit(input.limit))
            .all<QuarantineRetentionRow>()
          for (const item of quarantine.results) {
            const result = await raw
              .prepare(
                `INSERT OR IGNORE INTO messaging_retention_tombstones
                 (id, shop_id, resource_type, resource_id, action, status, due_at,
                  attempt_count, created_at, updated_at)
                 VALUES (?, NULL, 'incident_quarantine', ?, 'delete_quarantine',
                  'pending', ?, 0, ?, ?)`
              )
              .bind(
                `mrt_quarantine_${item.id}`,
                item.id,
                input.now,
                input.now,
                input.now
              )
              .run()
            scheduled += result.meta.changes ?? 0
          }
          return scheduled
        },
        catch: unavailable('schedule-retention')
      })

    const schedulePrivacyDeletion = (input: {
      readonly now: string
      readonly shopId: string
    }) =>
      Effect.tryPromise({
        try: async () => {
          const results = await raw.batch([
            raw
              .prepare(
                `INSERT OR IGNORE INTO messaging_retention_tombstones
                 (id, shop_id, resource_type, resource_id, action, status, due_at,
                  attempt_count, created_at, updated_at)
                 SELECT 'mrt_destination_' || pmd.id, pmd.shop_id,
                        'protected_messaging_destination', pmd.id, 'erase_destination',
                        'pending', ?, 0, ?, ?
                 FROM protected_messaging_destinations pmd
                 WHERE pmd.shop_id = ? AND pmd.erased_at IS NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM messaging_retention_holds mrh
                     WHERE mrh.resource_type = 'protected_messaging_destination'
                       AND mrh.resource_id = pmd.id AND mrh.status = 'active'
                   )`
              )
              .bind(input.now, input.now, input.now, input.shopId),
            raw
              .prepare(
                `INSERT OR IGNORE INTO messaging_retention_tombstones
                 (id, shop_id, resource_type, resource_id, action, status, due_at,
                  attempt_count, created_at, updated_at)
                 SELECT 'mrt_provider_reference_' || ppr.id, ppr.shop_id,
                        'protected_provider_reference', ppr.id,
                        'erase_provider_reference', 'pending', ?, 0, ?, ?
                 FROM protected_provider_references ppr
                 WHERE ppr.shop_id = ? AND ppr.erased_at IS NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM messaging_retention_holds mrh
                     WHERE mrh.resource_type = 'protected_provider_reference'
                       AND mrh.resource_id = ppr.id AND mrh.status = 'active'
                   )`
              )
              .bind(input.now, input.now, input.now, input.shopId),
            raw
              .prepare(
                `INSERT OR IGNORE INTO messaging_retention_tombstones
                 (id, shop_id, resource_type, resource_id, action, status, due_at,
                  attempt_count, created_at, updated_at)
                 SELECT 'mrt_controlled_facts_' || nicf.intent_id, nicf.shop_id,
                        'notification_intent_controlled_facts', nicf.intent_id,
                        'erase_facts', 'pending', ?, 0, ?, ?
                 FROM notification_intent_controlled_facts nicf
                 WHERE nicf.shop_id = ? AND nicf.erased_at IS NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM messaging_retention_holds mrh
                     WHERE mrh.resource_type = 'notification_intent_controlled_facts'
                       AND mrh.resource_id = nicf.intent_id AND mrh.status = 'active'
                   )`
              )
              .bind(input.now, input.now, input.now, input.shopId)
          ])
          return results.reduce(
            (total, result) => total + (result.meta.changes ?? 0),
            0
          )
        },
        catch: unavailable('schedule-privacy-deletion')
      })

    const processRetention = (input: {
      readonly now: string
      readonly ownerId: string
      readonly limit: number
    }) =>
      Effect.tryPromise({
        try: async (): Promise<RetentionResult> => {
          const rows = await raw
            .prepare(
              `SELECT id, resource_type, resource_id, action
               FROM messaging_retention_tombstones
               WHERE due_at <= ? AND
                 (status IN ('pending', 'failed') OR
                  (status = 'leased' AND leased_until <= ?))
               ORDER BY due_at, id LIMIT ?`
            )
            .bind(input.now, input.now, validLimit(input.limit))
            .all<TombstoneRow>()
          let completed = 0
          let failed = 0
          for (const tombstone of rows.results) {
            const lease = await raw
              .prepare(
                `UPDATE messaging_retention_tombstones
                 SET status = 'leased', lease_owner = ?, leased_until = ?,
                     attempt_count = attempt_count + 1, last_failure_code = NULL,
                     updated_at = ?
                 WHERE id = ? AND
                   (status IN ('pending', 'failed') OR
                    (status = 'leased' AND leased_until <= ?))`
              )
              .bind(
                input.ownerId,
                after(input.now, 5 * 60 * 1_000),
                input.now,
                tombstone.id,
                input.now
              )
              .run()
            if ((lease.meta.changes ?? 0) === 0) continue
            try {
              const erase =
                tombstone.action === 'erase_destination'
                  ? raw
                      .prepare(
                        `UPDATE protected_messaging_destinations
                         SET ciphertext = NULL, fingerprint = NULL, masked_value = NULL,
                             erased_at = COALESCE(erased_at, ?)
                         WHERE id = ? AND erased_at IS NULL`
                      )
                      .bind(input.now, tombstone.resource_id)
                  : tombstone.action === 'erase_provider_reference'
                    ? raw
                        .prepare(
                          `UPDATE protected_provider_references
                           SET ciphertext = NULL, masked_suffix = NULL,
                               erased_at = COALESCE(erased_at, ?)
                           WHERE id = ? AND erased_at IS NULL`
                        )
                        .bind(input.now, tombstone.resource_id)
                    : tombstone.action === 'erase_facts'
                      ? raw
                          .prepare(
                            `UPDATE notification_intent_controlled_facts
                             SET facts_json = '{}', facts_fingerprint = 'erased',
                                 erased_at = COALESCE(erased_at, ?)
                             WHERE intent_id = ? AND erased_at IS NULL`
                          )
                          .bind(input.now, tombstone.resource_id)
                      : tombstone.action === 'delete_quarantine'
                        ? raw
                            .prepare(
                              `DELETE FROM messaging_incident_quarantine WHERE id = ?`
                            )
                            .bind(tombstone.resource_id)
                        : undefined
              if (!erase) throw new Error('retention_action_not_implemented')
              const results = await raw.batch([
                erase,
                raw
                  .prepare(
                    `UPDATE messaging_retention_tombstones
                     SET status = 'completed', completed_at = COALESCE(completed_at, ?),
                         lease_owner = NULL, leased_until = NULL, updated_at = ?
                     WHERE id = ? AND status = 'leased' AND lease_owner = ?
                       AND changes() > 0`
                  )
                  .bind(input.now, input.now, tombstone.id, input.ownerId)
              ])
              completed += results[1]?.meta.changes ?? 0
            } catch (cause) {
              failed += 1
              await raw
                .prepare(
                  `UPDATE messaging_retention_tombstones
                   SET status = 'failed', lease_owner = NULL, leased_until = NULL,
                       last_failure_code = ?, updated_at = ?
                   WHERE id = ? AND lease_owner = ?`
                )
                .bind(
                  cause instanceof Error ? cause.message : 'retention_failed',
                  input.now,
                  tombstone.id,
                  input.ownerId
                )
                .run()
            }
          }
          return { inspected: rows.results.length, completed, failed }
        },
        catch: unavailable('process-retention')
      })

    return { reconcile, scheduleRetention, schedulePrivacyDeletion, processRetention }
  })
)
