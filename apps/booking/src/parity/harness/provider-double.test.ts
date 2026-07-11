import { describe, expect, it } from 'vitest'
import { createProviderDouble } from './provider-double.ts'

describe('deterministic optional-provider double', () => {
  it('returns declared outcomes and rejects undeclared operations', async () => {
    const provider = createProviderDouble('email', {
      'send-confirmation': { status: 'retryable-failure', code: 'provider_timeout' }
    })

    await expect(
      provider.invoke('send-confirmation', { appointmentId: 'apt-1' })
    ).resolves.toEqual({ status: 'retryable-failure', code: 'provider_timeout' })
    await expect(provider.invoke('send-reminder', {})).rejects.toThrow(
      /undeclared email operation/i
    )
  })
})
