import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { runCustomerDirectoryRequest } from './customer-directory-runner.ts'

describe('Customer Directory request runner', () => {
  it('reports a missing D1 binding through the typed capability error channel', async () => {
    await expect(
      runCustomerDirectoryRequest({
        db: undefined,
        userId: 'usr_owner',
        effect: Effect.succeed('unreachable')
      })
    ).rejects.toMatchObject({
      _tag: 'CapabilityUnavailable',
      capability: 'customer-directory',
      reason: 'Merchant App D1 binding is unavailable.'
    })
  })
})
