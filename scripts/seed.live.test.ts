import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildSeedSql } from './seed.ts'

let test: TestD1 | undefined

beforeAll(async () => {
  test = await provisionTestD1()
  await test.d1.exec(buildSeedSql())
})

afterAll(async () => {
  await test?.dispose()
})

describe('Booking seed SQL on D1', () => {
  it('persists an active checkout policy for the Mara merchant', async () => {
    if (!test) throw new Error('Test D1 was not provisioned')
    const policy = await test.d1
      .prepare(
        'SELECT id, scope, scope_id, kind, disclosure FROM checkout_policies WHERE id = ?'
      )
      .bind('pol_seed_checkout')
      .first()

    expect(policy).toEqual({
      id: 'pol_seed_checkout',
      scope: 'merchant',
      scope_id: 'mer_seed_booking_studio',
      kind: 'checkout',
      disclosure: 'Cancel up to 24 hours before the appointment.'
    })
  })
})
