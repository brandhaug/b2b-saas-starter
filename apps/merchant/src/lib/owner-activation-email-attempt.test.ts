import { describe, expect, it, vi } from 'vitest'
import {
  completeOwnerActivationEmailAttempt,
  startOwnerActivationEmailAttempt
} from './owner-activation-email-attempt.ts'

describe('Owner activation email attempts', () => {
  it('reuses the command identity only when the prior evidence explicitly permits retry', () => {
    const createCommandId = vi
      .fn()
      .mockReturnValueOnce('command-one')
      .mockReturnValueOnce('command-two')

    const first = startOwnerActivationEmailAttempt(null, createCommandId)
    const retryable = completeOwnerActivationEmailAttempt(first, { retryable: true })
    const retry = startOwnerActivationEmailAttempt(retryable, createCommandId)
    const complete = completeOwnerActivationEmailAttempt(retry, { retryable: false })
    const next = startOwnerActivationEmailAttempt(complete, createCommandId)

    expect(first.commandId).toBe('command-one')
    expect(retry.commandId).toBe('command-one')
    expect(next.commandId).toBe('command-two')
    expect(createCommandId).toHaveBeenCalledTimes(2)
  })
})
