import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { SeedAssistantDirectory } from '@b2b-saas-starter/capabilities/assistant/directory.seed'
import {
  type AssistantConversationLifecycle,
  AssistantConversationLifecycleLayer
} from '@b2b-saas-starter/capabilities/assistant/lifecycle'
import { AssistantDirectory } from '@b2b-saas-starter/capabilities/assistant/directory'
import { runCapabilities } from '../capabilities'
import { fixtureAuthModule } from '@/test/fixture-session'
import {
  loadOwnedConversationsHandler,
  deleteOwnedConversationHandler
} from './account-conversations.effects'
import type * as AuthModule from './auth'
const actor = vi.hoisted(() => ({ userId: 'usr_departed' }))
vi.mock('./auth', async (importOriginal) =>
  fixtureAuthModule(await importOriginal<typeof AuthModule>(), actor)
)
vi.mock('../capabilities', () => {
  const runtime = ManagedRuntime.make(
    AssistantConversationLifecycleLayer().pipe(
      Layer.provideMerge(SeedAssistantDirectory)
    )
  )
  return {
    runCapabilities: <A, E>(
      effect: Effect.Effect<A, E, AssistantDirectory | AssistantConversationLifecycle>
    ) => runtime.runPromise(effect)
  }
})
beforeEach(() => {
  actor.userId = 'usr_departed'
})
describe('identity-owned retained conversation deletion', () => {
  it('lists only safe metadata and deletes without current workspace membership', async () => {
    await runCapabilities(
      Effect.flatMap(AssistantDirectory, (directory) =>
        directory.create({
          id: 'account-retained',
          workspaceId: 'former-workspace',
          creatorUserId: actor.userId
        })
      )
    )
    const result = await loadOwnedConversationsHandler()
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    const row = result.value.find((entry) => entry.id === 'account-retained')
    expect(row).toEqual({ id: 'account-retained', createdAt: expect.any(String) })
    expect(
      await deleteOwnedConversationHandler({ conversationId: 'account-retained' })
    ).toEqual({ ok: true, value: undefined })
    const stored = await runCapabilities(
      Effect.flatMap(AssistantDirectory, (directory) =>
        directory.get('account-retained')
      )
    )
    expect(stored?.deletedAt).not.toBeNull()
  })

  it('another account cannot enumerate or delete the retained conversation', async () => {
    await runCapabilities(
      Effect.flatMap(AssistantDirectory, (directory) =>
        directory.create({
          id: 'account-private',
          workspaceId: 'former-workspace',
          creatorUserId: 'usr_other'
        })
      )
    )
    const result = await loadOwnedConversationsHandler()
    expect(
      result.ok && result.value.some((entry) => entry.id === 'account-private')
    ).toBe(false)
    expect(
      await deleteOwnedConversationHandler({ conversationId: 'account-private' })
    ).toEqual({ ok: true, value: undefined })
    const stored = await runCapabilities(
      Effect.flatMap(AssistantDirectory, (directory) =>
        directory.get('account-private')
      )
    )
    expect(stored?.deletedAt).toBeNull()
  })
})
