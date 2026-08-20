import { describe, expect, it } from 'vitest'
import { Effect, Layer, Ref, type Scope } from 'effect'
import {
  makeSeedRoster,
  SeedWorkspaceInvitations,
  testWorkspaceContext,
  WorkspaceInvitations,
  type WorkspaceContext,
  type Actor,
  type Invitation,
  type Member,
  type Workspace,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities'
import {
  EmailDispatcher,
  EmailSendError,
  type EmailDeliveryResult,
  type EmailMessage
} from '@b2b-saas-starter/email'
import {
  acceptInvitation,
  cancelInvitation,
  invitationPreview,
  sendInvitation
} from './invitations'

/**
 * The invitation surface below its session gate.
 *
 * `sendInvitation` and friends take the actor's address, the request origin and
 * the email dispatcher as arguments, so everything the server functions add on
 * top — `requireRequestSession`, `requestOrigin`, `webInvitationBinding` — is
 * out of the way, and what is left is the behaviour: the permission gates, the
 * non-disclosure rule the accept page depends on, and the email-failure
 * fallback. The fixture invitations are seeded per test, which the app's own
 * layer cannot do (`SeedWorkspaceInvitations` starts empty in `layers.ts`).
 *
 * Real clock on purpose: `@effect/vitest`'s `it.effect` runs a `TestClock`
 * starting at epoch 0, which would put the expired fixture below in the
 * future. These are plain `it` + `Effect.runPromise`.
 */

const workspace: Workspace = {
  id: 'wrk_test',
  slug: 'test-lab',
  name: 'Test Lab',
  planId: 'starter'
}

function actor(role: WorkspaceRole): Actor {
  return { userId: `usr_${role}`, role, systemRole: 'user' }
}

const OWNER = actor('owner')
const MEMBER = actor('member')

const ownerMember: Member = {
  id: OWNER.userId,
  name: 'Owner',
  email: 'owner@example.com',
  role: 'owner',
  systemRole: 'user'
}

const INVITEE = 'invitee@example.com'

/** Far enough out that no test run overtakes it. */
const FUTURE = '2099-01-01T00:00:00.000Z'

function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: 'inv_seeded',
    email: INVITEE,
    role: 'member',
    status: 'pending',
    expiresAt: FUTURE,
    ...overrides
  }
}

/** Every message the dispatcher was handed, so a test can read the recipient. */
type Outbox = { readonly sent: EmailMessage[] }

function emailDispatcher(outbox: Outbox, fails = false): Layer.Layer<EmailDispatcher> {
  return Layer.succeed(EmailDispatcher)({
    send: (message) => {
      outbox.sent.push(message)
      if (fails) {
        return Effect.fail(
          new EmailSendError({
            message: 'provider_rejected',
            to: message.to,
            subject: message.subject
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
}

/**
 * What `run` provides: the fixture layers, plus the `Scope` the permission
 * guard needs to annotate the request's wide event on a denial.
 */
type TestServices =
  | Scope.Scope
  | WorkspaceContext
  | WorkspaceInvitations
  | EmailDispatcher

type Harness = {
  readonly actor?: Actor | null
  readonly seed?: readonly Invitation[]
  readonly members?: readonly Member[]
  readonly emailFails?: boolean
}

/**
 * Runs one effect against a fresh fixture. `roster` and `outbox` come back so a
 * test can assert on what the run changed outside its return value — accepting
 * adds a member, and a send hands the dispatcher a message.
 */
function run<A, E>(
  harness: Harness,
  body: (services: {
    readonly invitations: WorkspaceInvitations['Service']
    readonly outbox: Outbox
  }) => Effect.Effect<A, E, TestServices>
): Promise<{
  readonly result: A
  readonly roster: readonly Member[]
  readonly outbox: Outbox
}> {
  const outbox: Outbox = { sent: [] }
  return Effect.runPromise(
    Effect.gen(function* () {
      const roster = yield* makeSeedRoster(harness.members ?? [ownerMember])
      const layer = Layer.mergeAll(
        SeedWorkspaceInvitations({ roster, workspace, seed: harness.seed ?? [] }),
        // `in` rather than `??`: a test that passes `actor: null` is asserting
        // what the guard does with no principal, not asking for the default.
        testWorkspaceContext(
          workspace,
          'actor' in harness ? (harness.actor ?? null) : OWNER
        ),
        emailDispatcher(outbox, harness.emailFails ?? false)
      )
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const invitations = yield* WorkspaceInvitations
          return yield* body({ invitations, outbox })
        }).pipe(Effect.provide(layer))
      )
      return { result, roster: yield* Ref.get(roster), outbox }
    })
  )
}

/** Turns a typed failure into a value, so a denial is asserted not thrown. */
function outcome<A, E extends { readonly _tag: string; readonly reason?: string }, R>(
  effect: Effect.Effect<A, E, R>
) {
  return Effect.match(effect, {
    onSuccess: (value) => ({ tag: 'ok', value }),
    onFailure: (failure) => ({ tag: failure._tag, reason: failure.reason })
  })
}

describe('sendInvitation', () => {
  it('emails an owner the link the accept page is keyed by', async () => {
    const { result, outbox } = await run({}, () =>
      sendInvitation({ email: INVITEE, role: 'member', origin: 'https://app.test' })
    )
    expect(result.delivered).toBe(true)
    // The id in the link is the invitation's own — the whole reason issue #64
    // removed the worker's `?workspace=<slug>` link.
    expect(result.inviteUrl).toBe(
      `https://app.test/invitations/accept?invitation=${result.invitation.id}`
    )
    expect(result.invitation).toMatchObject({
      email: INVITEE,
      role: 'member',
      status: 'pending'
    })
    expect(outbox.sent.map((message) => message.to)).toEqual([INVITEE])
    expect(outbox.sent[0]?.subject).toContain('Test Lab')
  })

  it('keeps the link relative when there is no request origin', async () => {
    const { result } = await run({}, () =>
      sendInvitation({ email: INVITEE, role: 'admin', origin: '' })
    )
    expect(result.inviteUrl).toBe(
      `/invitations/accept?invitation=${result.invitation.id}`
    )
  })

  it('reports a failed send without losing the invitation', async () => {
    const { result } = await run({ emailFails: true }, ({ invitations }) =>
      Effect.gen(function* () {
        const sent = yield* sendInvitation({
          email: INVITEE,
          role: 'member',
          origin: 'https://app.test'
        })
        // Persisted regardless: the inviter can pass the link on by hand.
        return { sent, stored: yield* invitations.list }
      })
    )
    expect(result.sent.delivered).toBe(false)
    expect(result.sent.inviteUrl).toContain(result.sent.invitation.id)
    expect(result.stored.map((row) => row.id)).toEqual([result.sent.invitation.id])
  })

  it('refuses a member, and invites nothing', async () => {
    const { result, outbox } = await run({ actor: MEMBER }, ({ invitations }) =>
      Effect.gen(function* () {
        const attempt = yield* outcome(
          sendInvitation({ email: INVITEE, role: 'member', origin: '' })
        )
        return { attempt, stored: yield* invitations.list }
      })
    )
    expect(result.attempt).toEqual({
      tag: 'AuthorizationDenied',
      reason: 'insufficient_permission'
    })
    expect(result.stored).toEqual([])
    expect(outbox.sent).toEqual([])
  })

  it('refuses when the context resolved no actor', async () => {
    const { result } = await run({ actor: null }, () =>
      outcome(sendInvitation({ email: INVITEE, role: 'member', origin: '' }))
    )
    expect(result).toEqual({ tag: 'AuthorizationDenied', reason: 'no_principal' })
  })
})

describe('cancelInvitation', () => {
  it('settles a pending invitation for an owner', async () => {
    const { result } = await run({ seed: [invitation()] }, ({ invitations }) =>
      Effect.gen(function* () {
        yield* cancelInvitation({ invitationId: 'inv_seeded' })
        return yield* invitations.list
      })
    )
    expect(result.map((row) => row.status)).toEqual(['canceled'])
  })

  it('refuses a member, and leaves the invitation pending', async () => {
    const { result } = await run(
      { actor: MEMBER, seed: [invitation()] },
      ({ invitations }) =>
        Effect.gen(function* () {
          const attempt = yield* outcome(
            cancelInvitation({ invitationId: 'inv_seeded' })
          )
          return { attempt, stored: yield* invitations.list }
        })
    )
    expect(result.attempt).toEqual({
      tag: 'AuthorizationDenied',
      reason: 'insufficient_permission'
    })
    expect(result.stored.map((row) => row.status)).toEqual(['pending'])
  })

  it('rejects an invitation that is not pending rather than reporting an outage', async () => {
    const { result } = await run({ seed: [invitation({ status: 'accepted' })] }, () =>
      outcome(cancelInvitation({ invitationId: 'inv_seeded' }))
    )
    expect(result).toEqual({
      tag: 'MembershipChangeRejected',
      reason: 'invitation_not_pending'
    })
  })
})

describe('invitationPreview', () => {
  it('describes the invitation to the address it was sent to', async () => {
    const { result } = await run({ seed: [invitation({ role: 'admin' })] }, () =>
      // Mixed case on purpose: the plugin lower-cases both sides, so a
      // mixed-case sign-up must still be shown its own invitation.
      invitationPreview({
        invitationId: 'inv_seeded',
        viewerEmail: 'Invitee@Example.com'
      })
    )
    expect(result).toEqual({
      state: 'pending',
      invitationId: 'inv_seeded',
      workspaceName: 'Test Lab',
      workspaceSlug: 'test-lab',
      role: 'admin'
    })
  })

  // One opaque answer for every other outcome: an invitation id is a URL
  // parameter, so anything disclosed for a mismatched address tells a
  // link-guesser which workspaces exist.
  const opaque: readonly {
    readonly name: string
    readonly harness: Harness
    readonly viewerEmail: string
  }[] = [
    { name: 'an unknown id', harness: { seed: [] }, viewerEmail: INVITEE },
    {
      name: 'an accepted invitation',
      harness: { seed: [invitation({ status: 'accepted' })] },
      viewerEmail: INVITEE
    },
    {
      name: 'a cancelled invitation',
      harness: { seed: [invitation({ status: 'canceled' })] },
      viewerEmail: INVITEE
    },
    {
      name: 'somebody else’s address',
      harness: { seed: [invitation()] },
      viewerEmail: 'stranger@example.com'
    }
  ]

  it.each(opaque)(
    'says only "unavailable" for $name',
    async ({ harness, viewerEmail }) => {
      const { result } = await run(harness, () =>
        invitationPreview({ invitationId: 'inv_seeded', viewerEmail })
      )
      expect(result).toEqual({ state: 'unavailable' })
    }
  )
})

describe('acceptInvitation', () => {
  it('makes the recipient a member, with no workspace gate at all', async () => {
    const { result, roster } = await run(
      { seed: [invitation({ role: 'admin' })] },
      () =>
        acceptInvitation({
          invitationId: 'inv_seeded',
          userId: 'usr_invitee',
          email: INVITEE
        })
    )
    expect(result).toEqual({
      workspaceSlug: 'test-lab',
      workspaceName: 'Test Lab',
      role: 'admin'
    })
    // The accepter was not a member before this call — membership is what
    // accepting creates, which is why there is no `WorkspaceContext` here.
    expect(roster.map((member) => member.id)).toEqual([ownerMember.id, 'usr_invitee'])
  })

  const refusals: readonly {
    readonly name: string
    readonly harness: Harness
    readonly email: string
    readonly reason: string
  }[] = [
    {
      name: 'an address the invitation was not sent to',
      harness: { seed: [invitation()] },
      email: 'stranger@example.com',
      reason: 'not_the_recipient'
    },
    {
      name: 'an expired invitation',
      harness: { seed: [invitation({ expiresAt: '2020-01-01T00:00:00.000Z' })] },
      email: INVITEE,
      reason: 'invitation_expired'
    },
    {
      name: 'an invitation that was already accepted',
      harness: { seed: [invitation({ status: 'accepted' })] },
      email: INVITEE,
      reason: 'invitation_not_pending'
    }
  ]

  it.each(refusals)('refuses $name', async ({ harness, email, reason }) => {
    const { result, roster } = await run(harness, () =>
      outcome(
        acceptInvitation({ invitationId: 'inv_seeded', userId: 'usr_invitee', email })
      )
    )
    expect(result).toEqual({ tag: 'MembershipChangeRejected', reason })
    expect(roster.map((member) => member.id)).toEqual([ownerMember.id])
  })
})
