import { Context, DateTime, Effect, Layer, Result, type Scope } from 'effect'

import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type WorkspaceNotFound } from '../errors.ts'
import { errorMessage } from '@b2b-saas-starter/failure'
import {
  buildWorkspaceExportArchive,
  type WorkspaceExportSnapshot
} from './workspace-export-archive.ts'
import {
  collectWorkspaceExportSnapshot,
  workspaceExportSnapshotContextEffect,
  type WorkspaceExportSnapshotServices
} from './workspace-export-snapshot.ts'
import {
  WorkspaceExports,
  type FailWorkspaceExportInput,
  type WorkspaceExportQueueMessage,
  type WorkspaceExportsInterface
} from './workspace-export.ts'
import { type WorkspaceContext, type WorkspaceServices } from '../workspace-context.ts'
import { WorkspaceSuspensionService } from './workspace-suspension.ts'

/** The trusted context adapter selected by the queue composition root. */
export type ResolveWorkspace = (
  slug: string
) => Layer.Layer<WorkspaceServices, WorkspaceNotFound | CapabilityUnavailable>

export type WorkspaceExportGenerationInput = {
  readonly message: WorkspaceExportQueueMessage
  /** Supplied by the queue adapter from its configured retry limit. */
  readonly finalAttempt: boolean
}

export type WorkspaceExportGenerationResult =
  | { readonly _tag: 'ready'; readonly sizeBytes: number }
  | { readonly _tag: 'skipped'; readonly reason: string }
  | { readonly _tag: 'retry'; readonly reason: string }

export type WorkspaceExportGenerationInterface = {
  readonly generate: (
    input: WorkspaceExportGenerationInput
  ) => Effect.Effect<WorkspaceExportGenerationResult, CapabilityUnavailable>
}

export class WorkspaceExportGeneration extends Context.Service<
  WorkspaceExportGeneration,
  WorkspaceExportGenerationInterface
>()('@b2b-saas-starter/capabilities/WorkspaceExportGeneration') {}

type GenerationDependencies =
  | WorkspaceExports
  | WorkspaceExportSnapshotServices
  | WorkspaceSuspensionService

export type WorkspaceExportArchiveBuild = {
  readonly snapshot: WorkspaceExportSnapshot
  readonly archive: Uint8Array
}

/** The shared collect→gzip implementation used by Seed and the queue worker. */
export function buildWorkspaceExportArchiveEffect(input: {
  readonly exportId: string
  readonly generatedAt: DateTime.Utc
}): Effect.Effect<
  WorkspaceExportArchiveBuild,
  CapabilityUnavailable,
  WorkspaceExportSnapshotServices | WorkspaceContext
> {
  return Effect.gen(function* () {
    const snapshot = yield* collectWorkspaceExportSnapshot(input)
    const archive = yield* Effect.tryPromise({
      try: () => buildWorkspaceExportArchive(snapshot),
      catch: (cause) =>
        new CapabilityUnavailable({
          capability: 'workspace-export-archive',
          reason: errorMessage(cause) ?? 'the archive build failed'
        })
    })
    return { snapshot, archive }
  })
}

function failed(
  input: WorkspaceExportGenerationInput,
  reason: string,
  exports: WorkspaceExportsInterface
): Effect.Effect<WorkspaceExportGenerationResult, CapabilityUnavailable> {
  const failure: FailWorkspaceExportInput = {
    exportId: input.message.exportId,
    workspaceId: input.message.workspaceId,
    reason
  }
  const result = { _tag: 'skipped', reason } satisfies WorkspaceExportGenerationResult
  return exports.fail(failure).pipe(Effect.map(() => result))
}

function unavailable(
  input: WorkspaceExportGenerationInput,
  reason: string,
  exports: WorkspaceExportsInterface
): Effect.Effect<WorkspaceExportGenerationResult, CapabilityUnavailable> {
  if (!input.finalAttempt) {
    return Effect.succeed({ _tag: 'retry', reason })
  }
  return failed(input, `unavailable: ${reason}`, exports)
}

function settledSuspension(
  input: WorkspaceExportGenerationInput,
  exports: WorkspaceExportsInterface
) {
  return failed(input, 'workspace_suspended', exports)
}

/** Builds the shared generator with stable snapshot and lifecycle dependencies. */
export function workspaceExportGenerationEffect(
  resolveWorkspace: ResolveWorkspace
): Effect.Effect<
  WorkspaceExportGenerationInterface,
  never,
  GenerationDependencies | Scope.Scope
> {
  return Effect.gen(function* () {
    const exports = yield* WorkspaceExports
    const suspension = yield* WorkspaceSuspensionService
    const scope = yield* Effect.scope
    const snapshotContext = yield* workspaceExportSnapshotContextEffect()
    const generate = Effect.fn('WorkspaceExportGeneration.generate')(function* (
      input: WorkspaceExportGenerationInput
    ) {
      const message = input.message
      const allowed = yield* Effect.result(
        suspension.requireAllowed(message.workspaceId, 'product')
      )
      if (Result.isFailure(allowed)) {
        if (allowed.failure._tag === 'WorkspaceSuspended') {
          return yield* settledSuspension(input, exports)
        }
        return yield* unavailable(input, allowed.failure.reason, exports)
      }

      const built = yield* Effect.result(
        Effect.gen(function* () {
          const workspaceContext = yield* Layer.buildWithScope(
            resolveWorkspace(message.workspaceSlug),
            scope
          )
          return yield* buildWorkspaceExportArchiveEffect({
            exportId: message.exportId,
            generatedAt: yield* DateTime.now
          }).pipe(
            Effect.provide(snapshotContext),
            Effect.provideContext(workspaceContext)
          )
        })
      )

      if (Result.isFailure(built)) {
        if (built.failure._tag === 'WorkspaceNotFound') {
          return yield* failed(input, 'workspace_not_found', exports)
        }
        return yield* unavailable(input, built.failure.reason, exports)
      }
      if (built.success.snapshot.workspace.id !== message.workspaceId) {
        return yield* failed(input, 'workspace_mismatch', exports)
      }

      const completed = yield* Effect.result(
        exports.complete({
          exportId: message.exportId,
          workspaceId: message.workspaceId,
          archive: built.success.archive
        })
      )
      if (Result.isFailure(completed)) {
        if (completed.failure._tag === 'WorkspaceSuspended') {
          return yield* settledSuspension(input, exports)
        }
        return yield* unavailable(input, completed.failure.reason, exports)
      }
      if (!completed.success) {
        return {
          _tag: 'skipped',
          reason: 'already_settled'
        } satisfies WorkspaceExportGenerationResult
      }
      return {
        _tag: 'ready',
        sizeBytes: built.success.archive.length
      } satisfies WorkspaceExportGenerationResult
    })
    return WorkspaceExportGeneration.of({ generate })
  })
}

/**
 * Builds and settles one queued export. The queue only supplies identity and
 * retry state; snapshot dependencies, archive ordering, and terminal row
 * settlement stay behind this interface.
 */
export function WorkspaceExportGenerationLayer(
  resolveWorkspace: ResolveWorkspace
): Layer.Layer<WorkspaceExportGeneration, never, GenerationDependencies> {
  return Layer.effect(WorkspaceExportGeneration)(
    workspaceExportGenerationEffect(resolveWorkspace)
  )
}
