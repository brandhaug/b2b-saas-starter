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

    const first = startOwnerActivationEmailAttempt(null, createCommandId, 'ro')
    const retryable = completeOwnerActivationEmailAttempt(first, {
      status: 'failed',
      retryable: true
    })
    const retry = startOwnerActivationEmailAttempt(retryable, createCommandId, 'en')
    const submitting = completeOwnerActivationEmailAttempt(retry, {
      status: 'submitting',
      retryable: false
    })
    const inProgressRetry = startOwnerActivationEmailAttempt(
      submitting,
      createCommandId,
      'en'
    )
    const complete = completeOwnerActivationEmailAttempt(inProgressRetry, {
      status: 'accepted',
      retryable: false
    })
    const next = startOwnerActivationEmailAttempt(complete, createCommandId, 'en')

    expect(first.commandId).toBe('command-one')
    expect(first.locale).toBe('ro')
    expect(retry.commandId).toBe('command-one')
    expect(retry.locale).toBe('ro')
    expect(inProgressRetry.commandId).toBe('command-one')
    expect(inProgressRetry.locale).toBe('ro')
    expect(next.commandId).toBe('command-two')
    expect(next.locale).toBe('en')
    expect(createCommandId).toHaveBeenCalledTimes(2)
  })
})
