export type OwnerActivationEmailAttempt = {
  readonly commandId: string
  readonly reuseCommand: boolean
}

export const startOwnerActivationEmailAttempt = (
  previous: OwnerActivationEmailAttempt | null,
  createCommandId: () => string
): OwnerActivationEmailAttempt => ({
  commandId: previous?.reuseCommand ? previous.commandId : createCommandId(),
  reuseCommand: false
})

export const completeOwnerActivationEmailAttempt = (
  attempt: OwnerActivationEmailAttempt,
  evidence: { readonly status: string; readonly retryable: boolean }
): OwnerActivationEmailAttempt => ({
  ...attempt,
  reuseCommand: evidence.retryable || evidence.status === 'submitting'
})
