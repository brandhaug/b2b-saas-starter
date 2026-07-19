import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { batch, Database, DbBatchError, layerFromD1 } from './index.ts'
import { merchants } from './schema.ts'
import { provisionTestD1, type TestD1 } from './testing.ts'

let test: TestD1
let dbLayer: ReturnType<typeof layerFromD1>
const iso = '2026-07-11T09:00:00.000Z'

beforeAll(async () => {
  test = await provisionTestD1()
  dbLayer = layerFromD1(test.d1)
}, 60_000)
afterAll(async () => test.dispose())

const run = <A, E>(effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromise(Effect.provide(effect, dbLayer))

describe('contracted Booking Product D1', () => {
  it('ships only authentication and Booking Product tables', async () => {
    const rows = await test.d1
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all<{ name: string }>()
    const tables = new Set(rows.results.map((row) => row.name))
    for (const table of [
      'user',
      'session',
      'account',
      'verification',
      'merchants',
      'merchant_memberships',
      'providers',
      'services',
      'provider_service_eligibility',
      'schedule_rules',
      'public_booking_pages',
      'booking_sessions',
      'booking_session_additional_services',
      'time_slot_holds',
      'appointments',
      'confirmation_access',
      'booking_outbox',
      'platform_api_tokens',
      'platform_webhook_endpoints',
      'platform_webhook_events',
      'platform_webhook_deliveries',
      'audit_events',
      'operations_audit_events',
      'brands',
      'shops',
      'shop_addresses',
      'shop_providers',
      'shop_services',
      'customer_accounts',
      'marketing_consents',
      'booking_parties',
      'booking_requests',
      'pricing_quotes',
      'pricing_adjustments',
      'pricing_quote_acceptances',
      'pricing_policies',
      'promotions',
      'promotion_reservations',
      'settlement_allocations',
      'payments',
      'payment_attempts',
      'payment_transactions',
      'gift_card_sales',
      'gift_card_products',
      'gift_cards',
      'gift_card_ledger_entries',
      'gift_card_reservations',
      'waiting_list_applications',
      'availability_offers',
      'walk_in_entries',
      'checkout_policies',
      'policy_acceptances',
      'lifecycle_history',
      'protected_access_grants',
      'notification_intents',
      'scheduled_work'
    ])
      expect(tables, `missing table ${table}`).toContain(table)
    for (const table of [
      'workspaces',
      'workspace_members',
      'starter_modules',
      'workspace_module_states',
      'catalog_refresh_runs',
      'webhook_endpoints'
    ])
      expect(tables, `superseded table ${table}`).not.toContain(table)
  })

  it('rolls back a merchant batch when one statement fails', async () => {
    const outcome = await run(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(merchants).values({
          id: 'mrc_existing',
          publicName: 'Existing',
          slug: 'existing',
          timezone: 'UTC',
          currency: 'EUR',
          createdAt: iso,
          updatedAt: iso
        })
        const error = yield* Effect.flip(
          batch(db, [
            db.insert(merchants).values({
              id: 'mrc_new',
              publicName: 'New',
              slug: 'new',
              timezone: 'UTC',
              currency: 'EUR',
              createdAt: iso,
              updatedAt: iso
            }),
            db.insert(merchants).values({
              id: 'mrc_existing',
              publicName: 'Duplicate',
              slug: 'duplicate',
              timezone: 'UTC',
              currency: 'EUR',
              createdAt: iso,
              updatedAt: iso
            })
          ])
        )
        const inserted = yield* db
          .select()
          .from(merchants)
          .where(eq(merchants.id, 'mrc_new'))
        return { error, inserted: inserted.length }
      })
    )
    expect(outcome.error).toBeInstanceOf(DbBatchError)
    expect(outcome.inserted).toBe(0)
  })
})
