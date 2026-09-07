import {
  EmailDispatcher,
  EmailSendError,
  type EmailDeliveryResult,
  type EmailMessage
} from '@b2b-saas-starter/email'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { Effect, Layer } from 'effect'

import { fixtureSession } from '@/test/fixture-session'
import {
  acceptInvitationHandler,
  cancelInvitationHandler,
  invitationPreviewHandler,
  previewInvitation,
  resendInvitationHandler,
  sendInvitationHandler
} from './invitations.effects'
import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'

/**
 * The invitation surface, driven through its handlers. The request adds
 * three things — the session, the request origin, and the email dispatcher —
 * and each is answered by a mock so the behaviour is the real path:
 * `runWorkspaceCapabilities` resolves the inert `cloudflare:workers` shim
 * under Vitest (vite.config.ts), so `DB` is undefined and the in-memory Seed
 * layer answers (its invitation store starts empty, exactly like `layers.ts`
 * builds it).
 *
 * What that makes testable here: the `invitation:create` / `invitation:
 * cancel` gates, the emailed link's shape, the email-failure fallback, and
 * the one opaque answer every unknown invitation id gets. The accept-verb
 * refusals (expired, addressed elsewhere, already accepted) are the
 * capability's own rules and stay in its contract tests; the preview's
 * collapse of those same refusals is staged directly against
 * `previewInvitation` below.
 *
 * Real clock on purpose: plain `it`, not `it.effect`.
 */
const INVITEE = 'invitee@example.com'
const BOKMAL_RECIPIENT = 'martin@example.com'

const env = vi.hoisted(() => ({
  userId: 'usr_demo',
  email: 'demo@starter.local',
  origin: 'https://app.test',
  emailFails: false,
  rateAllowed: true,
  // oxlint-disable-next-line effect/noAs, anti-slop/require-safety-comment-for-type-assertion -- a widening annotation only: the empty outbox gains the message type the dispatcher pushes into it
  outbox: [] as Array<EmailMessage>
}))

vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  requireRequestSession: async () => fixtureSession(env)
}))

vi.mock('./request-origin', () => ({
  requestOrigin: () => env.origin
}))

import type * as AuthEmailsModule from './auth-emails'
import type * as AuthModule from './auth'
import type * as RateLimitModule from '../rate-limit'

vi.mock('../rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof RateLimitModule>()
  return {
    ...actual,
    makeRateLimiterLayer: () =>
      Layer.succeed(actual.RateLimiter)({ take: () => Effect.succeed(env.rateAllowed) })
  }
})

vi.mock('./auth-emails', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthEmailsModule>()),
  emailDispatcherLayer: () =>
    Layer.succeed(EmailDispatcher)({
      send: (message) => {
        env.outbox.push(message)
        if (env.emailFails) {
          return Effect.fail(
            new EmailSendError({
              message: 'provider_rejected',
              to: message.to,
              subject: message.subject,
              failureKind: 'permanent'
            })
          )
        }
        return Effect.succeed({
          mode: 'log',
          to: message.to,
          subject: message.subject
        } satisfies EmailDeliveryResult)
      }
    })
}))

function actingAs(userId: string): void {
  env.userId = userId
}

describe('sendInvitationHandler', () => {
  beforeEach(() => {
    actingAs('usr_demo')
    env.origin = 'https://app.test'
    env.emailFails = false
    env.rateAllowed = true
    env.outbox = []
  })

  it('emails the owner the link the accept page is keyed by', async () => {
    const sent = await sendInvitationHandler({
      workspaceSlug: 'starter-lab',
      email: INVITEE,
      role: 'member'
    })
    expect(sent.status).toBe('logged')
    // The id in the link is the invitation's own — the whole reason issue
    // #64 removed the worker's `?workspace=<slug>` link.
    expect(sent.inviteUrl).toBe(
      `https://app.test/invitations/accept?invitation=${sent.invitation.id}`
    )
    expect(sent.invitation).toMatchObject({
      email: INVITEE,
      role: 'member',
      status: 'pending'
    })
    expect(env.outbox.map((message) => message.to)).toEqual([INVITEE])
    expect(env.outbox[0]?.subject).toContain('Starter Lab')
  })

  it('keeps the link relative when there is no request origin', async () => {
    env.origin = ''
    const sent = await sendInvitationHandler({
      workspaceSlug: 'starter-lab',
      email: INVITEE,
      role: 'admin'
    })
    expect(sent.inviteUrl).toBe(`/invitations/accept?invitation=${sent.invitation.id}`)
  })

  it('uses the saved recipient locale for an invitation email', async () => {
    const sent = await sendInvitationHandler({
      workspaceSlug: 'starter-lab',
      email: BOKMAL_RECIPIENT,
      role: 'member'
    })
    expect(sent.status).toBe('logged')
    expect(env.outbox[0]?.subject).toBe('Du er invitert til Starter Lab')
    expect(JSON.stringify(env.outbox[0]?.element)).toContain('Bli med i Starter Lab')
  })

  it('reports a failed send without losing the invitation', async () => {
    env.emailFails = true
    const sent = await sendInvitationHandler({
      workspaceSlug: 'starter-lab',
      email: INVITEE,
      role: 'member'
    })
    // Persisted regardless: the inviter can pass the link on by hand.
    expect(sent.status).toBe('failed')
    expect(sent.inviteUrl).toContain(sent.invitation.id)
    expect(sent.invitation.status).toBe('pending')
  })

  it('refuses a member, and invites nothing', async () => {
    actingAs('usr_dev')
    await expect(
      sendInvitationHandler({
        workspaceSlug: 'starter-lab',
        email: INVITEE,
        role: 'member'
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
    expect(env.outbox).toEqual([])
  })
})

describe('resendInvitationHandler (#285)', () => {
  beforeEach(() => {
    actingAs('usr_demo')
    env.rateAllowed = true
    env.outbox = []
  })

  it('refuses a plain member before looking up or sending an invitation', async () => {
    actingAs('usr_dev')
    await expect(
      resendInvitationHandler({ workspaceSlug: 'starter-lab', invitationId: 'unknown' })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
    expect(env.outbox).toEqual([])
  })

  it('enforces the resend rate budget for an authorized owner', async () => {
    env.rateAllowed = false
    await expect(
      resendInvitationHandler({ workspaceSlug: 'starter-lab', invitationId: 'unknown' })
    ).rejects.toMatchObject({ name: 'CapabilityUnavailableError' })
    expect(env.outbox).toEqual([])
  })

  it('does not resend an unknown or another workspace invitation', async () => {
    await expect(
      resendInvitationHandler({ workspaceSlug: 'starter-lab', invitationId: 'unknown' })
    ).rejects.toMatchObject({ name: 'MembershipRefusedError' })
    expect(env.outbox).toEqual([])
  })
})

describe('cancelInvitationHandler', () => {
  beforeEach(() => actingAs('usr_demo'))

  it('refuses a member', async () => {
    actingAs('usr_dev')
    await expect(
      cancelInvitationHandler({
        workspaceSlug: 'starter-lab',
        invitationId: 'inv_unknown'
      })
    ).rejects.toMatchObject({ name: 'ForbiddenError' })
  })

  it('rejects an invitation that is not pending rather than reporting an outage', async () => {
    await expect(
      cancelInvitationHandler({
        workspaceSlug: 'starter-lab',
        invitationId: 'inv_unknown'
      })
    ).rejects.toMatchObject({ name: 'MembershipRefusedError' })
  })
})

describe('invitationPreviewHandler', () => {
  beforeEach(() => actingAs('usr_demo'))

  // One opaque answer for an unknown id: an invitation id is a URL
  // parameter, so anything disclosed for one tells a link-guesser which
  // workspaces exist.
  it('says only "unavailable" for an unknown id', async () => {
    const preview = await invitationPreviewHandler({ invitationId: 'inv_unknown' })
    expect(preview).toEqual({ state: 'unavailable' })
  })
})

describe('previewInvitation — the non-disclosure collapse', () => {
  // The handler cannot stage fixtures (each run builds a fresh Seed layer),
  // so the collapse rule itself is driven directly: whatever an invitation
  // refuses must answer exactly what an unknown id answers, or a link-guesser
  // learns which workspaces exist from the difference.
  const FUTURE = '2099-01-01T00:00:00.000Z'
  const PAST = '2020-01-01T00:00:00.000Z'

  function invitation(overrides: Partial<Invitation> = {}) {
    return {
      id: 'inv_seeded',
      email: INVITEE,
      role: 'member',
      status: 'pending',
      expiresAt: FUTURE,
      workspaceSlug: 'starter-lab',
      workspaceName: 'Starter Lab',
      ...overrides
    } satisfies Invitation & {
      readonly workspaceSlug: string
      readonly workspaceName: string
    }
  }

  it('describes a pending invitation to its recipient', async () => {
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- server-fn handler pattern per apps/web/AGENTS.md keeps plain it (TestClock epoch 0 vs session-expiry fixtures)
    const preview = await Effect.runPromise(previewInvitation(invitation(), INVITEE))
    expect(preview).toEqual({
      state: 'pending',
      invitationId: 'inv_seeded',
      workspaceName: 'Starter Lab',
      workspaceSlug: 'starter-lab',
      role: 'member'
    })
  })

  it('answers a wrong-recipient viewer with the same opaque answer as an unknown id', async () => {
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- server-fn handler pattern per apps/web/AGENTS.md keeps plain it (TestClock epoch 0 vs session-expiry fixtures)
    const preview = await Effect.runPromise(
      previewInvitation(invitation(), 'someone-else@example.com')
    )
    expect(preview).toEqual({ state: 'unavailable' })
  })

  it('answers an expired invitation with the same opaque answer', async () => {
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- server-fn handler pattern per apps/web/AGENTS.md keeps plain it (TestClock epoch 0 vs session-expiry fixtures)
    const preview = await Effect.runPromise(
      previewInvitation(invitation({ expiresAt: PAST }), INVITEE)
    )
    expect(preview).toEqual({ state: 'unavailable' })
  })

  it('answers an already-settled invitation with the same opaque answer', async () => {
    // oxlint-disable-next-line starter/no-run-promise-in-tests -- server-fn handler pattern per apps/web/AGENTS.md keeps plain it (TestClock epoch 0 vs session-expiry fixtures)
    const preview = await Effect.runPromise(
      previewInvitation(invitation({ status: 'accepted' }), INVITEE)
    )
    expect(preview).toEqual({ state: 'unavailable' })
  })
})

describe('acceptInvitationHandler', () => {
  beforeEach(() => actingAs('usr_demo'))

  it('refuses an unknown invitation — never fabricates a membership', async () => {
    await expect(
      acceptInvitationHandler({ invitationId: 'inv_unknown' })
    ).rejects.toMatchObject({ name: 'MembershipRefusedError' })
  })
})
