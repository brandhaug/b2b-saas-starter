import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import {
  Database,
  moduleStatuses,
  starterModules,
  workspaceModuleStates
} from '@b2b-saas-starter/db'
import { WorkspaceContext } from '../workspace-context.ts'

export const MODULE_STATUSES = moduleStatuses
export const ModuleStatus = Schema.Literals(MODULE_STATUSES)
export type ModuleStatus = typeof ModuleStatus.Type

export const StarterModule = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  category: Schema.String,
  summary: Schema.String,
  docsPath: Schema.String,
  optional: Schema.Boolean
})
export type StarterModule = typeof StarterModule.Type

export const ModuleState = Schema.Struct({
  moduleId: Schema.String,
  enabled: Schema.Boolean,
  status: ModuleStatus,
  missingConfig: Schema.Array(Schema.String),
  updatedAt: Schema.String
})
export type ModuleState = typeof ModuleState.Type

export const StarterModuleWithState = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  category: Schema.String,
  summary: Schema.String,
  docsPath: Schema.String,
  optional: Schema.Boolean,
  state: ModuleState
})
export type StarterModuleWithState = typeof StarterModuleWithState.Type

export type StarterModuleCatalogShape = {
  readonly listModules: Effect.Effect<
    readonly StarterModuleWithState[],
    never,
    WorkspaceContext
  >
  readonly listAllModules: Effect.Effect<readonly StarterModule[]>
}

export class StarterModuleCatalog extends Context.Service<
  StarterModuleCatalog,
  StarterModuleCatalogShape
>()('@b2b-saas-starter/capabilities/StarterModuleCatalog') {}

export const SeedStarterModuleCatalog = (
  seed: readonly StarterModuleWithState[]
): Layer.Layer<StarterModuleCatalog> =>
  Layer.succeed(StarterModuleCatalog)({
    listModules: Effect.succeed(seed),
    listAllModules: Effect.succeed(seed.map(({ state: _state, ...module }) => module))
  })

export const LiveStarterModuleCatalog: Layer.Layer<
  StarterModuleCatalog,
  never,
  Database
> = Layer.effect(StarterModuleCatalog)(
  Effect.gen(function* () {
    const db = yield* Database
    return {
      listModules: Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        const rows = yield* Effect.promise(() =>
          db
            .select({ module: starterModules, state: workspaceModuleStates })
            .from(starterModules)
            .leftJoin(
              workspaceModuleStates,
              and(
                eq(workspaceModuleStates.moduleId, starterModules.id),
                eq(workspaceModuleStates.workspaceId, ctx.workspace.id)
              )
            )
        )
        return rows.map((row) => ({
          id: row.module.id,
          name: row.module.name,
          category: row.module.category,
          summary: row.module.summary,
          docsPath: row.module.docsPath,
          optional: row.module.optional,
          state: {
            moduleId: row.module.id,
            enabled: row.state?.enabled ?? false,
            status: row.state?.status ?? 'disabled',
            missingConfig: row.state?.missingConfig ?? [],
            updatedAt: row.state?.updatedAt ?? new Date().toISOString()
          }
        }))
      }),
      listAllModules: Effect.promise(() => db.select().from(starterModules)).pipe(
        Effect.map((rows) =>
          rows.map((row) => ({
            id: row.id,
            name: row.name,
            category: row.category,
            summary: row.summary,
            docsPath: row.docsPath,
            optional: row.optional
          }))
        )
      )
    }
  })
)
