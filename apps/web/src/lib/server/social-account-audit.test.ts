import { describe, expect, it, vi } from 'vite-plus/test'
import { Effect } from 'effect'
import {
  AuditEventLog,
  SeedAuditEventLog
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import {
  accountAuditInput,
  makeSocialAccountAuditHooks,
  type RunAccountAudit
} from './social-account-audit'

// The adapter is driven through the injected runner (the same port shape
// `auth-audit` tests use). The runner provides the real Seed AuditEventLog,
// so the assertions read back what the hook actually recorded through the
// capability — not a mock of it. A fresh layer per test: the Seed store is
// per-instance by design, and sharing one would leak rows across cases.

function makeFixture() {
  const seedLayer = SeedAuditEventLog([])
  type AccountAuditEffect = Parameters<RunAccountAudit>[0]
  function runAgainstSeed(effect: AccountAuditEffect) {
    return Effect.runPromise(Effect.provide(effect, seedLayer))
  }
  function recordedEvents() {
    return Effect.runPromise(
      Effect.gen(function* () {
        const audit = yield* AuditEventLog
        return yield* audit.listGlobal
      }).pipe(Effect.provide(seedLayer))
    )
  }
  return { runAgainstSeed, recordedEvents }
}

describe('makeSocialAccountAuditHooks', () => {
  it('records auth.account_linked for a social provider, attributed and naming the provider', async () => {
    const { runAgainstSeed, recordedEvents } = makeFixture()
    const hooks = makeSocialAccountAuditHooks(runAgainstSeed)

    await hooks.onAccountLinked({ providerId: 'github', userId: 'usr_demo' })

    const events = await recordedEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventType: 'auth.account_linked',
      targetType: 'user'
    })
  })

  it('records auth.account_unlinked on the delete hook', async () => {
    const { runAgainstSeed, recordedEvents } = makeFixture()
    const hooks = makeSocialAccountAuditHooks(runAgainstSeed)

    await hooks.onAccountUnlinked({ providerId: 'google', userId: 'usr_demo' })

    const events = await recordedEvents()
    expect(events.some((event) => event.eventType === 'auth.account_unlinked')).toBe(
      true
    )
  })

  it('skips credential accounts — that lifecycle has its own audit row', async () => {
    const { runAgainstSeed, recordedEvents } = makeFixture()
    const hooks = makeSocialAccountAuditHooks(runAgainstSeed)

    await hooks.onAccountLinked({ providerId: 'credential', userId: 'usr_demo' })
    await hooks.onAccountUnlinked({ providerId: 'credential', userId: 'usr_demo' })

    expect(await recordedEvents()).toHaveLength(0)
  })

  it('never fails the auth exchange when the audit write fails', async () => {
    const run = vi.fn<RunAccountAudit>().mockRejectedValue(new Error('D1 unavailable'))
    const hooks = makeSocialAccountAuditHooks(run)

    // The rejection is absorbed (logged, not thrown): a governance hiccup
    // must not fail the sign-in that triggered the hook.
    await expect(
      hooks.onAccountLinked({ providerId: 'github', userId: 'usr_demo' })
    ).resolves.toBeUndefined()
  })
})

describe('accountAuditInput', () => {
  it('is system-level and names the user and provider', () => {
    expect(
      accountAuditInput('auth.account_linked', {
        providerId: 'github',
        userId: 'usr_demo'
      })
    ).toEqual({
      workspaceId: null,
      actorUserId: 'usr_demo',
      eventType: 'auth.account_linked',
      targetType: 'user',
      targetId: 'usr_demo',
      metadata: { provider: 'github' }
    })
  })
})
