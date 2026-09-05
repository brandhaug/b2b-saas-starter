import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import {
  WorkspaceExports,
  type WorkspaceExport
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { hasValue } from '@b2b-saas-starter/env/server'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { Effect, Option, type Scope } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import {
  type RequestExportInput,
  type WorkspaceExportsSegment
} from './workspace-exports'

/**
 * The export segment assembly, the request effect and their server-only
 * wiring, reached only through dynamic `import()` inside the handler of
 * `requestWorkspaceExportServerFn` (`workspace-exports.ts`) — and by the
 * settings payload, which composes the segment
 * (`workspace-settings.effects.ts`); see apps/web/AGENTS.md.
 * `workspace-exports.ts` holds the client-safe half and the reason for the
 * split.
 */

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

export async function requestWorkspaceExportHandler(
  input: RequestExportInput
): Promise<WorkspaceExport> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(input.workspaceSlug, requestWorkspaceExport(), {
    userId: session.user.id
  })
}
