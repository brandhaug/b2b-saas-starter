import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { computeReadinessScore } from './catalog/adoption-readiness.ts'
import { SeedLayer } from './layers.ts'
import { seedWorkspaceRecord } from './seed-fixture.ts'
import { StarterModuleCatalog } from './catalog/starter-module-catalog.ts'
import { NotificationFeed } from './notifications/notification-feed.ts'
import { seedWorkspaceContext } from './workspace-context.ts'

const seedWorkspaceLayer = Layer.merge(
  SeedLayer,
  seedWorkspaceContext(seedWorkspaceRecord, seedWorkspaceRecord.slug)
)

describe('starter capabilities', () => {
  it('exposes seed starter modules through the catalog interface', async () => {
    const modules = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* StarterModuleCatalog
        return yield* catalog.listModules
      }).pipe(Effect.provide(seedWorkspaceLayer))
    )
    expect(modules.length).toBeGreaterThan(5)
  })

  it('counts unread notifications through the feed interface', async () => {
    const unread = await Effect.runPromise(
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        return yield* feed.unreadCount
      }).pipe(Effect.provide(seedWorkspaceLayer))
    )
    expect(unread).toBeGreaterThan(0)
  })

  it('derives readiness from module state', () => {
    const score = computeReadinessScore([
      {
        moduleId: 'a',
        enabled: true,
        status: 'ready',
        missingConfig: [],
        updatedAt: ''
      },
      {
        moduleId: 'b',
        enabled: true,
        status: 'needs-config',
        missingConfig: [],
        updatedAt: ''
      }
    ])
    expect(score).toBe(50)
  })
})
