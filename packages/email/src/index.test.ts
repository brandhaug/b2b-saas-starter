import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  EmailDispatcher,
  LogEmailDispatcherLayer,
  makeCloudflareEmailDispatcherLayer,
  WorkspaceInvitationEmail,
  type SendEmailBinding
} from './index.ts'

describe('EmailDispatcher', () => {
  it('logs delivery when no binding is configured', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* EmailDispatcher
        return yield* dispatcher.send({
          from: 'noreply@example.com',
          to: 'user@example.com',
          subject: 'You are invited',
          element: WorkspaceInvitationEmail({
            workspaceName: 'Starter Lab',
            inviteUrl: 'https://example.com/accept'
          })
        })
      }).pipe(Effect.provide(LogEmailDispatcherLayer))
    )
    expect(result).toEqual({
      mode: 'log',
      to: 'user@example.com',
      subject: 'You are invited'
    })
  })

  it('renders both html and text, then forwards to the binding', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const binding: SendEmailBinding = { send }

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* EmailDispatcher
        return yield* dispatcher.send({
          from: 'noreply@example.com',
          to: 'user@example.com',
          subject: 'Hello from the starter',
          element: WorkspaceInvitationEmail({
            workspaceName: 'Acme',
            inviteUrl: 'https://example.com/accept'
          })
        })
      }).pipe(Effect.provide(makeCloudflareEmailDispatcherLayer(binding)))
    )

    expect(send).toHaveBeenCalledTimes(1)
    const sent = send.mock.calls[0]?.[0] as {
      from: string
      to: string
      subject: string
      text?: string
      html?: string
    }
    expect(sent.from).toBe('noreply@example.com')
    expect(sent.to).toBe('user@example.com')
    expect(sent.subject).toBe('Hello from the starter')
    expect(sent.html).toContain('Acme')
    expect(sent.html).toContain('https://example.com/accept')
    expect(sent.text?.toLowerCase()).toContain('acme')
    expect(result.mode).toBe('cloudflare-email')
  })
})
