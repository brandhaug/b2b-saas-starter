export type OwnerActivationEmailAttempt = {
  readonly commandId: string
  readonly retryable: boolean
}

export const startOwnerActivationEmailAttempt = (
  previous: OwnerActivationEmailAttempt | null,
  createCommandId: () => string
): OwnerActivationEmailAttempt => ({
  commandId: previous?.retryable ? previous.commandId : createCommandId(),
  retryable: false
})

export const completeOwnerActivationEmailAttempt = (
  attempt: OwnerActivationEmailAttempt,
  evidence: { readonly retryable: boolean }
): OwnerActivationEmailAttempt => ({
  ...attempt,
  retryable: evidence.retryable
})
