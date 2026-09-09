import { type WorkspaceSuspended } from '@b2b-saas-starter/capabilities/errors'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import {
  WorkspaceExports,
  type WorkspaceExport
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { hasValue } from '@b2b-saas-starter/env/server'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { Effect, Option } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import {
  type RequestExportInput,
  type DownloadExportInput,
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

/** Settings lists export metadata; a deliberate download action mints the link. */
export const workspaceExportsSegment: Effect.Effect<
  WorkspaceExportsSegment,
  CapabilityUnavailable | WorkspaceSuspended,
  WorkspaceExports | WorkspaceContext
> = Effect.gen(function* () {
  const exports = yield* WorkspaceExports
  return { availability: yield* exports.availability, exports: yield* exports.list }
})

export async function downloadWorkspaceExportHandler(
  input: DownloadExportInput
): Promise<string | null> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ workspaceExport: ['download'] })
      const exports = yield* WorkspaceExports
      const link = yield* exports.issueDownloadLink({
        exportId: input.exportId,
        recipient: {
          type: 'session',
          userId: session.user.id,
          sessionId: session.session.id
        }
      })
      return Option.match(link, {
        onNone: () => null,
        onSome: (issued) => new URL(issued.path, apiPublicUrl()).toString()
      })
    }),
    { userId: session.user.id }
  )
}

export async function requestWorkspaceExportHandler(
  input: RequestExportInput
): Promise<WorkspaceExport> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      // Proves the actor may request (`workspaceExport:request`), then
      // hands the request to the capability.
      yield* requireWorkspacePermission({ workspaceExport: ['request'] })
      const exports = yield* WorkspaceExports
      return yield* exports.request
    }),
    { userId: session.user.id }
  )
}
