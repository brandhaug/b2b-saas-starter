import { Context, Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, workspaceModuleStates } from '@b2b-saas-starter/db'
import type { ModuleState } from './starter-module-catalog.ts'
import type { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'

export const ReadinessPoint = Schema.Struct({
  label: Schema.String,
  score: Schema.Number
})
export type ReadinessPoint = typeof ReadinessPoint.Type

export function computeReadinessScore(states: readonly ModuleState[]): number {
  if (states.length === 0) return 0
  const ready = states.filter((state) => state.status === 'ready').length
  return Math.round((ready / states.length) * 100)
}

export type ReadinessSnapshot = {
  readonly score: number
  readonly readyCount: number
  readonly totalCount: number
}

export function projectReadiness(states: readonly ModuleState[]): ReadinessSnapshot {
  const readyCount = states.filter((state) => state.status === 'ready').length
  return {
    score: computeReadinessScore(states),
    readyCount,
    totalCount: states.length
  }
}

export type AdoptionReadinessInterface = {
  readonly getTrend: Effect.Effect<
    readonly ReadinessPoint[],
    CapabilityUnavailable,
    WorkspaceContext
  >
}

export class AdoptionReadiness extends Context.Service<
  AdoptionReadiness,
  AdoptionReadinessInterface
>()('@b2b-saas-starter/capabilities/AdoptionReadiness') {}

export function SeedAdoptionReadiness(
  seed: readonly ReadinessPoint[]
): Layer.Layer<AdoptionReadiness> {
  return Layer.succeed(AdoptionReadiness)({
    getTrend: Effect.succeed(seed)
  })
}

export const LiveAdoptionReadiness: Layer.Layer<AdoptionReadiness, never, Database> =
  Layer.effect(AdoptionReadiness)(
    Effect.gen(function* () {
      const db = yield* Database
      return {
        getTrend: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const states = yield* orUnavailable('adoption-readiness')(
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
