import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { Deferred, Effect, Layer, ManagedRuntime } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { selectWorkspaceLayer } from '@b2b-saas-starter/capabilities/runtime'
import { listInvitationEmailHistory } from '@b2b-saas-starter/capabilities/governance/invitation-email-history'
import { EmailDispatcher, EmailSendError } from '@b2b-saas-starter/email'
import { fixtureSession } from '@/test/fixture-session'
import { sendInvitationHandler, resendInvitationHandler } from './invitations.effects'
import type * as CapabilitiesModule from '../capabilities'

function makeRuntime() {
  return ManagedRuntime.make(
    Layer.merge(
      selectWorkspaceLayer({}, 'starter-lab', { userId: 'usr_demo' }, 'user'),
      TestClock.layer()
    )
  )
}

let runtime: ReturnType<typeof makeRuntime>
let started: Deferred.Deferred<boolean>
let release: Deferred.Deferred<boolean>
let sendCount = 0
let failSend = false
let holdSend = false

vi.mock('../capabilities', async (importOriginal) => ({
  ...(await importOriginal<typeof CapabilitiesModule>()),
  runWorkspaceCapabilities: (
    _slug: string,
    effect: Parameters<typeof runtime.runPromise>[0]
  ) => runtime.runPromise(Effect.scoped(effect))
}))
vi.mock('./auth', () => ({
  requireRequestSession: async () => fixtureSession({ userId: 'usr_demo' })
}))
vi.mock('./request-origin', () => ({ requestOrigin: () => 'https://app.test' }))
vi.mock('./auth-emails', () => ({
  emailDispatcherLayer: () =>
    Layer.succeed(EmailDispatcher)({
      send: Effect.fn('test.sendInvitation')(function* (message) {
        sendCount++
        yield* Deferred.succeed(started, true)
        if (holdSend) {
          yield* Deferred.await(release)
        }
        if (failSend) {
          return yield* Effect.fail(
            new EmailSendError({
              message: 'transport_unavailable',
              to: message.to,
              subject: message.subject,
              failureKind: 'transient'
            })
          )
        }
        return {
          mode: 'cloudflare-email',
          to: message.to,
          subject: message.subject,
          providerMessageId: 'provider-accepted'
        }
      })
    })
}))

describe('durable invitation resend (#285)', () => {
  beforeEach(async () => {
    runtime = makeRuntime()
    started = await runtime.runPromise(Deferred.make<boolean>())
    release = await runtime.runPromise(Deferred.make<boolean>())
    sendCount = 0
    failSend = false
    holdSend = false
  })
  afterEach(async () => {
    await runtime.dispose()
  })

  it('refuses an accepted invitation even after its delivery becomes unconfirmed', async () => {
    const sent = await sendInvitationHandler({
      workspaceSlug: 'starter-lab',
      email: 'invitee@example.com',
      role: 'member'
    })
    expect(sent.status).toBe('accepted')
    await runtime.runPromise(TestClock.adjust('25 hours'))
    await expect(
      resendInvitationHandler({
        workspaceSlug: 'starter-lab',
        invitationId: sent.invitation.id
      })
    ).rejects.toBeDefined()
    expect(sendCount).toBe(1)
  })

  it('allows one provider submission for concurrent retries of the same transient failure', async () => {
    failSend = true
    const sent = await sendInvitationHandler({
      workspaceSlug: 'starter-lab',
      email: 'invitee@example.com',
      role: 'member'
    })
    expect(sent.status).toBe('failed')
    failSend = false
    holdSend = true
    started = await runtime.runPromise(Deferred.make<boolean>())
    const input = { workspaceSlug: 'starter-lab', invitationId: sent.invitation.id }
    const first = resendInvitationHandler(input)
    const second = resendInvitationHandler(input)
    await runtime.runPromise(Deferred.await(started))
    await runtime.runPromise(Deferred.succeed(release, true))
    const results = await Promise.allSettled([first, second])
    expect(
      results.some(
        (result) => result.status === 'fulfilled' && result.value.status === 'accepted'
      )
    ).toBe(true)
    expect(sendCount).toBe(2)
    const records = await runtime.runPromise(listInvitationEmailHistory())
    expect(records).toHaveLength(2)
    expect(records.filter((record) => record.acceptedAt !== null)).toHaveLength(1)
  })
})
