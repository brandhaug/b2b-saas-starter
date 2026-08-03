import { describe, expect, it, vi } from 'vitest'
import {
  completeOwnerActivationEmailAttempt,
  startOwnerActivationEmailAttempt
} from './owner-activation-email-attempt.ts'

describe('Owner activation email attempts', () => {
  it('keeps the command identity through retryable and in-progress evidence', () => {
    const createCommandId = vi
      .fn()
      .mockReturnValueOnce('command-one')
      .mockReturnValueOnce('command-two')

    const first = startOwnerActivationEmailAttempt(null, createCommandId)
    const retryable = completeOwnerActivationEmailAttempt(first, {
      status: 'failed',
      retryable: true
    })
    const retry = startOwnerActivationEmailAttempt(retryable, createCommandId)
    const submitting = completeOwnerActivationEmailAttempt(retry, {
      status: 'submitting',
      retryable: false
    })
    const inProgressRetry = startOwnerActivationEmailAttempt(
      submitting,
      createCommandId
    )
    const complete = completeOwnerActivationEmailAttempt(inProgressRetry, {
      status: 'accepted',
      retryable: false
    })
    const next = startOwnerActivationEmailAttempt(complete, createCommandId)

    expect(first.commandId).toBe('command-one')
    expect(retry.commandId).toBe('command-one')
    expect(inProgressRetry.commandId).toBe('command-one')
    expect(next.commandId).toBe('command-two')
    expect(createCommandId).toHaveBeenCalledTimes(2)
  })
})
