// oxlint-disable-next-line import/no-unassigned-import -- Authenticated session fixture for server-function boundaries.
import '@/test/qualified-session'
import { describe, expect, it, vi } from 'vite-plus/test'
import { fixtureAuthModule } from '@/test/fixture-session'
import type * as AuthModule from './auth'
import { createAssistantTaskHandler } from './assistant-tasks.effects'

const actor = vi.hoisted(() => ({ userId: 'usr_demo' }))
vi.mock('./auth', async (original) =>
  fixtureAuthModule(await original<typeof AuthModule>(), actor)
)

describe('assistant task authorization', () => {
  it('records the initiating member on a saved task', async () => {
    actor.userId = 'usr_demo'
    const task = await createAssistantTaskHandler({
      workspaceSlug: 'starter-lab',
      deliveryId: 'whd_seed_dead_lettered',
      question: 'Investigate this failure'
    })
    expect(task.requestedBy).toBe('usr_demo')
    expect(task.status).toBe('proposed')
  })

  it('does not expose webhook evidence to a member without webhook access', async () => {
    actor.userId = 'usr_dev'
    await expect(
      createAssistantTaskHandler({
        workspaceSlug: 'starter-lab',
        deliveryId: 'whd_seed_dead_lettered',
        question: 'Show evidence'
      })
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
})
