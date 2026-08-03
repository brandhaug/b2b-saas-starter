import {
  canReuseOwnerActivationTestCommand,
  type TransactionalEmailEvidence,
  type TransactionalEmailLocale
} from '@b2b-saas-starter/capabilities/notifications'

export type OwnerActivationEmailAttempt = {
  readonly commandId: string
  readonly locale: TransactionalEmailLocale
  readonly reuseCommand: boolean
}

export const startOwnerActivationEmailAttempt = (
  previous: OwnerActivationEmailAttempt | null,
  createCommandId: () => string,
  locale: TransactionalEmailLocale
): OwnerActivationEmailAttempt => ({
  commandId: previous?.reuseCommand ? previous.commandId : createCommandId(),
  locale: previous?.reuseCommand ? previous.locale : locale,
  reuseCommand: true
})

export const completeOwnerActivationEmailAttempt = (
  attempt: OwnerActivationEmailAttempt,
  evidence: Pick<TransactionalEmailEvidence, 'retryable' | 'status'>
): OwnerActivationEmailAttempt => ({
  ...attempt,
  reuseCommand: canReuseOwnerActivationTestCommand(evidence)
})
