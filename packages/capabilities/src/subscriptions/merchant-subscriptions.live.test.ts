import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  LiveMerchantSubscriptions,
  MerchantSubscriptions
} from './merchant-subscriptions.ts'

let test: TestD1
const now = '2026-08-03T00:00:00.000Z'

beforeAll(async () => {
  test = await provisionTestD1()
  for (const statement of [
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at) VALUES ('mer_retention_live', 'Retention', 'retention', 'UTC', 'EUR', 'solo', '${now}', '${now}')`,
    `INSERT INTO user (id, email, name, emailVerified, identityClass, createdAt, updatedAt) VALUES ('usr_retention_live', 'owner@retention.test', 'Retention Owner', 1, 'merchant_member', 1785715200, 1785715200)`,
    `INSERT INTO merchant_memberships (merchant_id, user_id, role, created_at) VALUES ('mer_retention_live', 'usr_retention_live', 'owner', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at) VALUES ('brd_retention_live', 'mer_retention_live', 'Retention', '${now}', '${now}')`,
    `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at) VALUES ('shp_retention_live', 'brd_retention_live', 'mer_retention_live', 'retention', 'Retention', 'UTC', 'EUR', '${now}', '${now}')`,
    `INSERT INTO providers (id, merchant_id, linked_user_id, display_name, status, is_default, created_at, updated_at) VALUES ('prv_retention_live', 'mer_retention_live', 'usr_retention_live', 'Owner', 'active', 1, '${now}', '${now}')`,
    `INSERT INTO services (id, merchant_id, name, description, price_minor, currency, duration_minutes, status, created_at, updated_at) VALUES ('svc_retention_live', 'mer_retention_live', 'Personal service', 'Private description', 1900, 'EUR', 30, 'active', '${now}', '${now}')`,
    `INSERT INTO schedule_rules (id, merchant_id, provider_id, weekday, start_time, end_time, created_at, updated_at) VALUES ('scr_retention_live', 'mer_retention_live', 'prv_retention_live', 1, '09:00', '17:00', '${now}', '${now}')`,
    `INSERT INTO public_booking_pages (id, merchant_id, status, created_at, updated_at) VALUES ('pbp_retention_live', 'mer_retention_live', 'published', '${now}', '${now}')`,
    `INSERT INTO merchant_subscriptions (id, merchant_id, plan, interval, status, provider_customer_ref, provider_subscription_ref, restricted_at, retention_ends_at, revision, created_at, updated_at) VALUES ('sub_retention_live', 'mer_retention_live', 'solo', 'monthly', 'restricted', 'cus_preserved', 'sub_preserved', '2025-08-03T00:00:00.000Z', '${now}', 4, '2025-08-03T00:00:00.000Z', '${now}')`,
    `INSERT INTO booking_sessions (id, merchant_id, capability_hash, lifecycle, customer_name, customer_email, customer_phone, created_at, last_activity_at, idle_expires_at, absolute_expires_at) VALUES ('bsn_retention_live', 'mer_retention_live', 'retention-live-capability-hash-000000000000000000000000000000000000', 'consumed', 'Personal Name', 'person@example.com', '+40700000000', '${now}', '${now}', '${now}', '${now}')`,
    `INSERT INTO appointments (id, merchant_id, provider_id, booking_session_id, status, starts_at, ends_at, snapshot, created_at, updated_at) VALUES ('apt_retention_live', 'mer_retention_live', 'prv_retention_live', 'bsn_retention_live', 'completed', '2025-01-01T10:00:00.000Z', '2025-01-01T11:00:00.000Z', '{"customerDetails":{"name":"Personal Name","email":"person@example.com","phone":"+40700000000"}}', '${now}', '${now}')`,
    `INSERT INTO customer_records (id, merchant_id, display_name, status, preferred_locale, merchant_note, revision, last_activity_at, created_at, updated_at) VALUES ('cur_retention_live', 'mer_retention_live', 'Personal Name', 'active', 'en', 'Private note', 1, '${now}', '${now}', '${now}')`,
    `INSERT INTO customer_contacts (id, customer_record_id, merchant_id, kind, normalized_value, status, is_preferred, created_at, updated_at) VALUES ('cct_retention_live', 'cur_retention_live', 'mer_retention_live', 'email', 'person@example.com', 'active', 1, '${now}', '${now}')`
  ])
    await test.d1.prepare(statement).run()
})

afterAll(async () => test.dispose())

describe('Live Merchant Subscription retention', () => {
  it('anonymizes operational personal data and preserves billing evidence', async () => {
    const layer = LiveMerchantSubscriptions.pipe(Layer.provide(layerFromD1(test.d1)))
    await Effect.runPromise(
      Effect.flatMap(MerchantSubscriptions, (subscriptions) =>
        subscriptions.tick(now)
      ).pipe(Effect.provide(layer))
    )
    const [
      session,
      appointment,
      customer,
      contact,
      subscription,
      disposition,
      merchant,
      provider,
      service,
      schedule,
      publicPage
    ] = await test.d1.batch([
      test.d1.prepare(
        "SELECT customer_name, customer_email, customer_phone FROM booking_sessions WHERE id = 'bsn_retention_live'"
      ),
      test.d1.prepare(
        "SELECT json_extract(snapshot, '$.customerDetails.name') name, json_extract(snapshot, '$.customerDetails.email') email FROM appointments WHERE id = 'apt_retention_live'"
      ),
      test.d1.prepare(
        "SELECT display_name, status, merchant_note FROM customer_records WHERE id = 'cur_retention_live'"
      ),
      test.d1.prepare(
        "SELECT normalized_value, status FROM customer_contacts WHERE id = 'cct_retention_live'"
      ),
      test.d1.prepare(
        "SELECT provider_customer_ref, provider_subscription_ref, retention_disposed_at FROM merchant_subscriptions WHERE merchant_id = 'mer_retention_live'"
      ),
      test.d1.prepare(
        "SELECT kind, policy_version FROM merchant_subscription_retention_dispositions WHERE merchant_id = 'mer_retention_live'"
      ),
      test.d1.prepare(
        "SELECT public_name, slug, status, booking_config_json FROM merchants WHERE id = 'mer_retention_live'"
      ),
      test.d1.prepare(
        "SELECT display_name, status, booking_access FROM providers WHERE id = 'prv_retention_live'"
      ),
      test.d1.prepare(
        "SELECT name, description, status FROM services WHERE id = 'svc_retention_live'"
      ),
      test.d1.prepare(
        "SELECT count(*) count FROM schedule_rules WHERE merchant_id = 'mer_retention_live'"
      ),
      test.d1.prepare(
        "SELECT status FROM public_booking_pages WHERE merchant_id = 'mer_retention_live'"
      )
    ])
    expect(session!.results[0]).toMatchObject({
      customer_name: null,
      customer_email: null,
      customer_phone: null
    })
    expect(appointment!.results[0]).toMatchObject({
      name: 'Erased customer',
      email: 'erased@invalid'
    })
    expect(customer!.results[0]).toMatchObject({
      display_name: 'Erased customer',
      status: 'erased',
      merchant_note: null
    })
    expect(contact!.results[0]).toMatchObject({
      normalized_value: 'erased:cct_retention_live',
      status: 'erased'
    })
    expect(subscription!.results[0]).toMatchObject({
      provider_customer_ref: 'cus_preserved',
      provider_subscription_ref: 'sub_preserved',
      retention_disposed_at: now
    })
    expect(disposition!.results[0]).toMatchObject({
      kind: 'merchant-operational-data-disposed',
      policy_version: 'solo-retention-v1'
    })
    expect(merchant!.results[0]).toMatchObject({
      public_name: 'Closed merchant',
      slug: 'closed-mer_retention_live',
      status: 'disabled',
      booking_config_json: null
    })
    expect(provider!.results[0]).toMatchObject({
      display_name: 'Closed provider',
      status: 'active',
      booking_access: 'restricted'
    })
    expect(service!.results[0]).toMatchObject({
      name: 'Retired service',
      description: null,
      status: 'inactive'
    })
    expect(schedule!.results[0]).toMatchObject({ count: 0 })
    expect(publicPage!.results[0]).toMatchObject({ status: 'unpublished' })
  })
})
