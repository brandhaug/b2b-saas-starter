import { Context, Effect, Layer, Schema } from 'effect'
import { desc, eq } from 'drizzle-orm'
import { Database, implementationReports } from '@b2b-saas-starter/db'
import type { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'

export const ImplementationReport = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: Schema.String,
  summary: Schema.String,
  createdAt: Schema.String
})
export type ImplementationReport = typeof ImplementationReport.Type

export type ImplementationReportsShape = {
  readonly list: Effect.Effect<
    readonly ImplementationReport[],
    CapabilityUnavailable,
    WorkspaceContext
  >
}

export class ImplementationReports extends Context.Service<
  ImplementationReports,
  ImplementationReportsShape
>()('@b2b-saas-starter/capabilities/ImplementationReports') {}

export const SeedImplementationReports = (
  seed: readonly ImplementationReport[]
): Layer.Layer<ImplementationReports> =>
  Layer.succeed(ImplementationReports)({
    list: Effect.succeed(seed)
  })

export const LiveImplementationReports: Layer.Layer<
  ImplementationReports,
  never,
  Database
> = Layer.effect(ImplementationReports)(
  Effect.gen(function* () {
    const db = yield* Database
    return {
      list: Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        const rows = yield* orUnavailable('implementation-reports')(
          db
            .select()
            .from(implementationReports)
            .where(eq(implementationReports.workspaceId, ctx.workspace.id))
            .orderBy(desc(implementationReports.createdAt))
        )
        return rows.map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          summary: row.summary,
          createdAt: row.createdAt
        }))
      })
    }
  })
)
