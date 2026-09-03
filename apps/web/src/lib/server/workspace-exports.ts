import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import {
  WorkspaceExports,
  type WorkspaceExport,
  type WorkspaceExportAvailability
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { hasValue } from '@b2b-saas-starter/env/server'
import { createServerFn } from '@tanstack/react-start'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { Effect, Option, Schema, type Scope } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'

/**
 * Workspace data export (ADR 0055) on the session surface: the settings page's
 * export segment and the "Request export" mutation. Both name the owner-only
 * `workspaceExport` statements — the loader withholds the segment from every
 * other role, and the server function re-checks the permission before the
 * capability call, like every other workspace mutation.
 */

/** One export as the settings page renders it: the record plus a signed link when it is downloadable. */
export type WorkspaceExportView = WorkspaceExport & {
  readonly downloadUrl: string | null
}

export type WorkspaceExportsSegment = {
  readonly availability: WorkspaceExportAvailability
  readonly exports: ReadonlyArray<WorkspaceExportView>
}

/**
 * Where signed download links point: the API worker serves them. `API_PUBLIC_URL`
 * names the deployed worker; unset means local development, where the API dev
 * server listens on 8787 (`apps/api/package.json`).
 */
const LOCAL_API_URL = 'http://localhost:8787'

function apiPublicUrl(): string {
  const configured = cloudflareEnv.API_PUBLIC_URL
  if (hasValue(configured)) {
    return configured
  }
  return LOCAL_API_URL
}

/**
 * The export segment of the settings payload. Links are minted here, at load
 * time, after `whenPermitted` has already decided the actor may download —
 * one signed URL per ready export, valid for the capability's link TTL.
 */
export const workspaceExportsSegment: Effect.Effect<
  WorkspaceExportsSegment,
  CapabilityUnavailable,
  WorkspaceExports | WorkspaceContext
> = Effect.gen(function* () {
  const exports = yield* WorkspaceExports
  const availability = yield* exports.availability
  const records = yield* exports.list
  const base = apiPublicUrl()
  const views = yield* Effect.forEach(
    records,
    (record) =>
      Effect.map(exports.issueDownloadLink({ exportId: record.id }), (link) => ({
        ...record,
        downloadUrl: Option.match(link, {
          onNone: () => null,
          onSome: (issued) => new URL(issued.path, base).toString()
        })
      })),
    { concurrency: 'unbounded' }
  )
  return { availability, exports: views }
})

const RequestExportInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const decodeRequestInput = Schema.decodeUnknownSync(RequestExportInput)

/**
 * The effect below the session gate: proves the actor may request
 * (`workspaceExport:request`), then hands the request to the capability.
 * Exported so tests drive it against fixture layers without an auth runtime.
 */
export function requestWorkspaceExport(): Effect.Effect<
  WorkspaceExport,
  AuthorizationDenied | CapabilityUnavailable,
  Scope.Scope | WorkspaceContext | WorkspaceExports
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ workspaceExport: ['request'] })
    const exports = yield* WorkspaceExports
    return yield* exports.request
  })
}

export const requestWorkspaceExportServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeRequestInput(input))
  .handler(async ({ data }): Promise<WorkspaceExport> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(data.workspaceSlug, requestWorkspaceExport(), {
      userId: session.user.id
    })
  })
