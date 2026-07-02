import { Context, Effect, Layer, Schema } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, integrationConnections } from '@b2b-saas-starter/db'
import { MODULE_STATUSES, ModuleStatus } from '../catalog/starter-module-catalog.ts'
import type { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'

export const IntegrationSurface = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  displayName: Schema.String,
  status: ModuleStatus,
  summary: Schema.String
})
export type IntegrationSurface = typeof IntegrationSurface.Type

const moduleStatusValues = new Set<string>(MODULE_STATUSES)

const decodeModuleStatusOrDisabled = (value: unknown): ModuleStatus =>
  typeof value === 'string' && moduleStatusValues.has(value)
    ? (value as ModuleStatus)
    : 'disabled'

export type IntegrationSurfacesShape = {
  readonly list: Effect.Effect<
    readonly IntegrationSurface[],
    CapabilityUnavailable,
    WorkspaceContext
  >
}

export class IntegrationSurfaces extends Context.Service<
  IntegrationSurfaces,
  IntegrationSurfacesShape
>()('@b2b-saas-starter/capabilities/IntegrationSurfaces') {}

export const SeedIntegrationSurfaces = (
  seed: readonly IntegrationSurface[]
): Layer.Layer<IntegrationSurfaces> =>
  Layer.succeed(IntegrationSurfaces)({
    list: Effect.succeed(seed)
  })

export const LiveIntegrationSurfaces: Layer.Layer<
  IntegrationSurfaces,
  never,
  Database
> = Layer.effect(IntegrationSurfaces)(
  Effect.gen(function* () {
    const db = yield* Database
    return {
      list: Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        const rows = yield* orUnavailable('integration-surfaces')(
          db
            .select()
            .from(integrationConnections)
            .where(eq(integrationConnections.workspaceId, ctx.workspace.id))
        )
        return rows.map((row) => ({
          id: row.id,
          provider: row.provider,
          displayName: row.displayName,
          status: decodeModuleStatusOrDisabled(row.status),
          summary: ''
        }))
      })
    }
  })
)
