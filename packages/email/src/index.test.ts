import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vite-plus/test'
import {
  EmailDispatcher,
  LogEmailDispatcherLayer,
  makeCloudflareEmailDispatcherLayer,
  type SendEmailBinding,
  type SendEmailBuilderArgs
} from './index.ts'
import { WorkspaceInvitationEmail } from './templates.tsx'

describe('EmailDispatcher', () => {
  it('logs delivery when no binding is configured', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* EmailDispatcher
        const result = yield* dispatcher.send({
          from: 'noreply@example.com',
          to: 'user@example.com',
          subject: 'You are invited',
          element: WorkspaceInvitationEmail({
            workspaceName: 'Starter Lab',
            inviteUrl: 'https://example.com/accept'
          })
        })
        expect(result).toEqual({
          mode: 'log',
          to: 'user@example.com',
          subject: 'You are invited'
        })
      }).pipe(Effect.provide(LogEmailDispatcherLayer))
    ))

  it('renders both html and text, then forwards to the binding', () => {
    const send = vi.fn<(message: SendEmailBuilderArgs) => Promise<void>>(() =>
      Promise.resolve()
    )
    const binding: SendEmailBinding = { send }

    return Effect.runPromise(
      Effect.gen(function* () {
        const dispatcher = yield* EmailDispatcher
        const result = yield* dispatcher.send({
          from: 'noreply@example.com',
          to: 'user@example.com',
          subject: 'Hello from the starter',
          element: WorkspaceInvitationEmail({
            workspaceName: 'Acme',
            inviteUrl: 'https://example.com/accept'
          })
        })

        expect(send).toHaveBeenCalledTimes(1)
        const sent = send.mock.calls[0]?.[0]
        expect(sent?.from).toBe('noreply@example.com')
        expect(sent?.to).toBe('user@example.com')
        expect(sent?.subject).toBe('Hello from the starter')
        expect(sent?.html).toContain('Acme')
        expect(sent?.html).toContain('https://example.com/accept')
        expect(sent?.text?.toLowerCase()).toContain('acme')
        expect(result.mode).toBe('cloudflare-email')
      }).pipe(Effect.provide(makeCloudflareEmailDispatcherLayer(binding)))
    )
  })
})
