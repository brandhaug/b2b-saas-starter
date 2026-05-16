import { Context, Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, workspaceModuleStates } from '@b2b-saas-starter/db'
import type { ModuleState } from './starter-module-catalog.ts'
import { WorkspaceContext } from '../workspace-context.ts'

export const ReadinessPoint = Schema.Struct({
  label: Schema.String,
  score: Schema.Number
})
export type ReadinessPoint = typeof ReadinessPoint.Type

export const computeReadinessScore = (states: readonly ModuleState[]): number => {
  if (states.length === 0) return 0
  const ready = states.filter((state) => state.status === 'ready').length
  return Math.round((ready / states.length) * 100)
}

export type ReadinessSnapshot = {
  readonly score: number
  readonly readyCount: number
  readonly totalCount: number
}

export const projectReadiness = (states: readonly ModuleState[]): ReadinessSnapshot => {
  const readyCount = states.filter((state) => state.status === 'ready').length
  return {
    score: states.length === 0 ? 0 : Math.round((readyCount / states.length) * 100),
    readyCount,
    totalCount: states.length
  }
}

export type AdoptionReadinessShape = {
  readonly getTrend: Effect.Effect<readonly ReadinessPoint[], never, WorkspaceContext>
}

export class AdoptionReadiness extends Context.Service<
  AdoptionReadiness,
  AdoptionReadinessShape
>()('@b2b-saas-starter/capabilities/AdoptionReadiness') {}

export const SeedAdoptionReadiness = (
  seed: readonly ReadinessPoint[]
): Layer.Layer<AdoptionReadiness> =>
  Layer.succeed(AdoptionReadiness)({
    getTrend: Effect.succeed(seed)
  })

export const LiveAdoptionReadiness: Layer.Layer<AdoptionReadiness, never, Database> =
  Layer.effect(AdoptionReadiness)(
    Effect.gen(function* () {
      const db = yield* Database
      return {
        getTrend: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const states = yield* Effect.promise(() =>
            db
              .select()
              .from(workspaceModuleStates)
              .where(eq(workspaceModuleStates.workspaceId, ctx.workspace.id))
          )
          return [
            {
              label: 'Now',
              score: computeReadinessScore(
                states.map((state) => ({
                  moduleId: state.moduleId,
                  enabled: state.enabled,
                  status: state.status,
                  missingConfig: state.missingConfig,
                  updatedAt: state.updatedAt
                }))
              )
            }
          ]
        })
      }
    })
  )
