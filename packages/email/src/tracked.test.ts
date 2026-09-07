import {
  EmailDelivery,
  type ClaimEmail
} from '@b2b-saas-starter/email-delivery/email-delivery'
import { SeedEmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery.seed'
import { describe, expect, it, vi } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import {
  EmailDispatcher,
  EmailSendError,
  type EmailDeliveryResult,
  type EmailMessage
} from './index.ts'
import { dispatchTrackedEmail } from './tracked.ts'
import { WorkspaceInvitationEmail } from './templates.tsx'

const input = {
  id: 'email_1',
  purpose: 'notification',
  recipient: 'user@example.com',
  userId: 'usr_1',
  workspaceId: null
} satisfies ClaimEmail

const message: EmailMessage = {
  to: input.recipient,
  subject: 'A notification',
  element: WorkspaceInvitationEmail({
    workspaceName: 'Starter Lab',
    inviteUrl: 'https://example.com/invite'
  })
}

function dispatcherLayer(
  send: EmailDispatcher['Service']['send']
): Layer.Layer<EmailDispatcher> {
  return Layer.succeed(EmailDispatcher, { send })
}

describe('dispatchTrackedEmail', () => {
  it.effect('persists provider acceptance and suppresses a duplicate send', () => {
    const send = vi.fn(() =>
      Effect.succeed({
        mode: 'cloudflare-email',
        to: message.to,
        subject: message.subject,
        providerMessageId: 'provider_1'
      } satisfies EmailDeliveryResult)
    )

    return Effect.gen(function* () {
      const first = yield* dispatchTrackedEmail(input, message)
      const second = yield* dispatchTrackedEmail(input, message)
      const record = yield* (yield* EmailDelivery).get(input.id)

      expect(first).toEqual({ status: 'accepted' })
      expect(second).toEqual({ status: 'skipped' })
      expect(send).toHaveBeenCalledTimes(1)
      expect(record).toMatchObject({
        status: 'accepted',
        providerMessageId: 'provider_1',
        acceptedAt: expect.any(String)
      })
      expect(record?.reason).toBeNull()
    }).pipe(Effect.provide(Layer.merge(SeedEmailDelivery(), dispatcherLayer(send))))
  })

  it.effect('stores a sanitized transient outcome for a failed provider send', () => {
    const send = vi.fn(() =>
      Effect.fail(
        new EmailSendError({
          message: 'email send failed: transient',
          to: message.to,
          subject: message.subject,
          failureKind: 'transient',
          providerCode: 'E_RATE_LIMIT_EXCEEDED'
        })
      )
    )

    return Effect.gen(function* () {
      const result = yield* Effect.result(dispatchTrackedEmail(input, message))
      const record = yield* (yield* EmailDelivery).get(input.id)

      expect(result._tag).toBe('Failure')
      expect(record).toMatchObject({
        status: 'temporary_failure',
        reason: 'transport_unavailable'
      })
      expect(record?.providerMessageId).toBeNull()
      expect(record?.reason).not.toContain('E_RATE_LIMIT_EXCEEDED')
      expect(record?.reason).not.toContain('user@example.com')
    }).pipe(Effect.provide(Layer.merge(SeedEmailDelivery(), dispatcherLayer(send))))
  })

  it.effect(
    'stores permanent and suppressed failures without retaining provider text',
    () => {
      const cases = [
        {
          failureKind: 'permanent',
          status: 'failed',
          reason: 'provider_rejected'
        },
        {
          failureKind: 'suppressed',
          status: 'suppressed',
          reason: 'provider_suppressed'
        }
      ] satisfies ReadonlyArray<{
        readonly failureKind: 'permanent' | 'suppressed'
        readonly status: 'failed' | 'suppressed'
        readonly reason: 'provider_rejected' | 'provider_suppressed'
      }>

      function runCase(current: (typeof cases)[number], id: string) {
        return Effect.gen(function* () {
          const currentInput = { ...input, id }
          yield* Effect.result(dispatchTrackedEmail(currentInput, message))
          const record = yield* (yield* EmailDelivery).get(currentInput.id)
          expect(record).toMatchObject({
            status: current.status,
            reason: current.reason
          })
        }).pipe(
          Effect.provide(
            Layer.merge(
              SeedEmailDelivery(),
              dispatcherLayer((sent) =>
                Effect.fail(
                  new EmailSendError({
                    message: `email send failed: ${current.failureKind}`,
                    to: sent.to,
                    subject: sent.subject,
                    failureKind: current.failureKind,
                    providerCode: 'E_RECIPIENT_SUPPRESSED'
                  })
                )
              )
            )
          )
        )
      }

      return Effect.all([
        runCase(cases[0]!, 'email_permanent'),
        runCase(cases[1]!, 'email_suppressed')
      ])
    }
  )
})
