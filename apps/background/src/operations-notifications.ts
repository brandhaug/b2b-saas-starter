import { Effect, Result } from 'effect'
import {
  OperationsNotificationOutbox,
  type OperationsNotificationWork
} from '@b2b-saas-starter/capabilities/operations'
import type { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import {
  EmailDispatcher,
  ImpersonationLifecycleEmail,
  impersonationLifecycleWording,
  type ImpersonationLifecycleEmailProps
} from '@b2b-saas-starter/email'

export const OPERATIONS_NOTIFICATION_RETRY_DELAYS = [30, 60, 90, 120, 150, 180] as const

export type OperationsNotificationProviderState =
  | 'configured'
  | 'capture'
  | 'needs_configuration'

export type CapturedOperationsNotification = {
  readonly idempotencyKey: string
  readonly eventType: OperationsNotificationWork['eventType']
  readonly to: string
  readonly merchant: string
  readonly occurredAt: string
  readonly supportReference: string | null
  readonly securityContact: string
}

const captured: CapturedOperationsNotification[] = []

const notificationLifecycle: Readonly<
  Record<
    OperationsNotificationWork['eventType'],
    ImpersonationLifecycleEmailProps['lifecycle']
  >
> = {
  'impersonation-started': 'started',
  'impersonation-stopped': 'stopped',
  'impersonation-expired': 'expired',
  'impersonation-revoked': 'revoked'
}

export const readCapturedOperationsNotifications = () => [...captured]
export const resetCapturedOperationsNotifications = () => {
  captured.length = 0
}

const capture = (work: OperationsNotificationWork): void => {
  captured.push({
    idempotencyKey: work.id,
    eventType: work.eventType,
    to: work.recipientEmail,
    merchant: work.merchantName,
    occurredAt: work.occurredAt,
    supportReference: work.supportReference,
    securityContact: work.securityContact
  })
}

export const processOperationsNotification = (input: {
  readonly intentId: string
  readonly now: string
  readonly providerState: OperationsNotificationProviderState
  readonly scheduleRetry?: (intentId: string, delaySeconds: number) => Promise<unknown>
}): Effect.Effect<
  void,
  CapabilityUnavailable,
  OperationsNotificationOutbox | EmailDispatcher
> =>
  Effect.gen(function* () {
    const store = yield* OperationsNotificationOutbox
    const work = yield* store.claim(input.intentId, input.now)
    if (!work) return

    if (input.providerState === 'needs_configuration') {
      const delay = 300
      yield* store.failed(
        work.id,
        work.claimedAt,
        work.attemptCount,
        'email_not_configured',
        new Date(Date.parse(input.now) + delay * 1_000).toISOString(),
        input.now
      )
      if (input.scheduleRetry)
        yield* Effect.promise(() => input.scheduleRetry!(work.id, delay)).pipe(
          Effect.catch(() => Effect.void)
        )
      return
    }

    const attemptNumber = work.attemptCount + 1
    if (input.providerState === 'capture') {
      capture(work)
      yield* store.delivered(work.id, work.claimedAt, attemptNumber, input.now)
      return
    }

    const dispatcher = yield* EmailDispatcher
    const lifecycle = notificationLifecycle[work.eventType]
    const wording = impersonationLifecycleWording(lifecycle)
    const result = yield* Effect.result(
      dispatcher.send({
        idempotencyKey: work.id,
        from: '',
        to: work.recipientEmail,
        subject: `Staff access to ${work.merchantName} ${wording}`,
        element: ImpersonationLifecycleEmail({
          merchant: work.merchantName,
          occurredAt: work.occurredAt,
          supportReference: work.supportReference,
          securityContact: work.securityContact,
          lifecycle
        })
      })
    )
    if (Result.isSuccess(result)) {
      yield* store.delivered(work.id, work.claimedAt, attemptNumber, input.now)
      return
    }

    const delay = OPERATIONS_NOTIFICATION_RETRY_DELAYS[attemptNumber - 1] ?? null
    const nextAttemptAt =
      delay === null
        ? null
        : new Date(Date.parse(input.now) + delay * 1_000).toISOString()
    yield* store.failed(
      work.id,
      work.claimedAt,
      attemptNumber,
      delay === null ? 'email_retries_exhausted' : 'email_send_failed',
      nextAttemptAt,
      input.now
    )
    if (delay !== null && input.scheduleRetry)
      yield* Effect.promise(() => input.scheduleRetry!(work.id, delay)).pipe(
        Effect.catch(() => Effect.void)
      )
  })

export const recoverOperationsNotifications = (now: string) =>
  Effect.flatMap(OperationsNotificationOutbox, (store) => store.recoverable(now))
