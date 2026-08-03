import { afterAll, describe, expect, it } from 'vitest'
import { applyMigrations, provisionUnmigratedTestD1, type TestD1 } from './testing.ts'

const previousMigration = '20260729190000_messaging_governance'
const soloMigration = '20260729200000_solo_entitlement'
const allocated: TestD1[] = []

afterAll(async () => Promise.all(allocated.map((test) => test.dispose())))

const provisionPrevious = async () => {
  const test = await provisionUnmigratedTestD1()
  allocated.push(test)
  await applyMigrations(test.d1, { through: previousMigration })
  return test
}

const insertMerchantGraph = async (
  test: TestD1,
  input: { readonly plan: 'solo' | 'team'; readonly providerCount: number }
) => {
  const now = '2026-07-29T20:00:00.000Z'
  await test.d1
    .prepare(
      `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
       VALUES ('mer_guard', 'Guard Studio', 'guard-studio', 'UTC', 'EUR', ?, ?, ?)`
    )
    .bind(input.plan, now, now)
    .run()
  for (let index = 0; index < input.providerCount; index += 1) {
    await test.d1
      .prepare(
        `INSERT INTO providers (id, merchant_id, display_name, status, is_default, created_at, updated_at)
         VALUES (?, 'mer_guard', ?, 'active', ?, ?, ?)`
      )
      .bind(`prv_guard_${index}`, `Provider ${index}`, index === 0 ? 1 : 0, now, now)
      .run()
  }
}

describe('BeeSolo Solo entitlement migration', () => {
  it('accepts a Solo Merchant with exactly one active default Provider', async () => {
    const test = await provisionPrevious()
    await insertMerchantGraph(test, { plan: 'solo', providerCount: 1 })

    await applyMigrations(test.d1, {
      after: previousMigration,
      through: soloMigration
    })

    await expect(
      test.d1
        .prepare(
          `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
           VALUES ('mer_injected', 'Injected', 'injected', 'UTC', 'EUR', 'team', 'now', 'now')`
        )
        .run()
    ).rejects.toThrow(/invalid merchant plan/)
  }, 60_000)

  it.each([
    { plan: 'team' as const, providerCount: 1, label: 'Team entitlement' },
    { plan: 'solo' as const, providerCount: 2, label: 'additional Provider' }
  ])(
    'aborts for incompatible $label rows',
    async ({ plan, providerCount }) => {
      const test = await provisionPrevious()
      await insertMerchantGraph(test, { plan, providerCount })

      await expect(
        applyMigrations(test.d1, {
          after: previousMigration,
          through: soloMigration
        })
      ).rejects.toThrow()

      const merchant = await test.d1
        .prepare(`SELECT plan FROM merchants WHERE id = 'mer_guard'`)
        .first<{ plan: string }>()
      const providerCountRow = await test.d1
        .prepare(
          `SELECT count(*) AS count FROM providers WHERE merchant_id = 'mer_guard'`
        )
        .first<{ count: number }>()
      expect(merchant?.plan).toBe(plan)
      expect(providerCountRow?.count).toBe(providerCount)
    },
    60_000
  )
})
