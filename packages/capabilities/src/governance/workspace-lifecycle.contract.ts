import { Effect } from 'effect'
import { type ContractExpectMatchers } from './contract-expect.ts'
import { type CapabilityUnavailable, type WorkspaceChangeRejected } from '../errors.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { WorkspaceLifecycle } from './workspace-lifecycle.ts'

/**
 * The workspace-lifecycle contract, written once and run against both
 * adapters — capabilities invariant 4, the same shape as the membership and
 * invitation contracts.
 *
 * The cases assert only what both adapters can honestly promise. The Seed
 * adapter fabricates identity fields and mints ids from `Clock`, so neither
 * id shapes nor member rosters are asserted here — only that a created
 * workspace is readable back, that renames land, that a taken slug is a
 * rejection rather than an unavailable, and that a delete removes.
 */

export type LifecycleContractIds = {
  /** A user with no workspace of their own; each case creates one for them. */
  readonly creator: string
  /** The slug already taken when the suite starts. */
  readonly existingSlug: string
}

export type LifecycleContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable | WorkspaceChangeRejected,
    WorkspaceLifecycle | WorkspaceContext | AuditEventLog
  >
}

/** The slice of vitest's `expect` these cases use — see the membership contract. */
export type ContractExpect = <A>(
  actual: A
) => Pick<ContractExpectMatchers<A>, 'toBe' | 'toContain'>

export function workspaceLifecycleContractCases(
  ids: LifecycleContractIds,
  expect: ContractExpect
): ReadonlyArray<LifecycleContractCase> {
  return [
    {
      name: 'creates a workspace and reads it back by its slug',
      assert: Effect.gen(function* () {
        const lifecycle = yield* WorkspaceLifecycle
        const slug = `${ids.existingSlug}-created`
        const workspace = yield* lifecycle.create({
          name: 'Created Lab',
          slug,
          userId: ids.creator
        })
        expect(workspace.slug).toBe(slug)
        expect(workspace.name).toBe('Created Lab')
      })
    },
    {
      name: 'refuses a slug that is already taken',
      assert: Effect.gen(function* () {
        const lifecycle = yield* WorkspaceLifecycle
        const outcome = yield* Effect.exit(
          lifecycle.create({
            name: 'Squatter',
            slug: ids.existingSlug,
            userId: ids.creator
          })
        )
        expect(failureTag(outcome)).toBe('WorkspaceChangeRejected')
      })
    },
    {
      name: 'renames the workspace in context',
      assert: Effect.gen(function* () {
        const lifecycle = yield* WorkspaceLifecycle
        const renamed = yield* lifecycle.rename({ name: 'Renamed Lab' })
        expect(renamed.name).toBe('Renamed Lab')
        // Everything else about the workspace survives the rename untouched.
        expect(renamed.slug).toContain('-lab')
      })
    },
    {
      // One audit case for the mutation family that both adapters can share
      // (delete is deliberately absent below, as its note explains). Same
      // delta-around-my-own-mutations shape as the developer-platform
      // contract's `api_token.revoked` case.
      name: 'creating and renaming a workspace records workspace audit events',
      assert: Effect.gen(function* () {
        const lifecycle = yield* WorkspaceLifecycle
        const log = yield* AuditEventLog
        const ctx = yield* WorkspaceContext
        function globalCountOf(eventType: string) {
          return Effect.map(
            log.listGlobal,
            (events) => events.filter((event) => event.eventType === eventType).length
          )
        }

        // `create` is identity-keyed, so its event is attributed to the
        // workspace being created — readable globally, not from this
        // context's per-workspace trail.
        const createdBefore = yield* globalCountOf('workspace.created')
        const created = yield* lifecycle.create({
          name: 'Audited Lab',
          slug: `${ids.existingSlug}-audited`,
          userId: ids.creator
        })
        const createdEvents = (yield* log.listGlobal).filter(
          (event) => event.eventType === 'workspace.created'
        )
        expect(createdEvents.length).toBe(createdBefore + 1)
        expect(
          createdEvents.some(
            (event) => event.targetId === created.id && event.targetType === 'workspace'
          )
        ).toBe(true)

        // The rename acts on the workspace in context, so its event lands in
        // this context's own trail.
        const renamedBefore = yield* globalCountOf('workspace.renamed')
        yield* lifecycle.rename({ name: 'Audited Lab II' })
        const renamedPage = yield* log.list({ eventType: 'workspace.renamed' })
        expect(renamedPage.events.length).toBe(renamedBefore + 1)
        expect(
          renamedPage.events.some(
            (event) =>
              event.targetId === ctx.workspace.id && event.targetType === 'workspace'
          )
        ).toBe(true)
      })
    }
    // Deletion is deliberately absent from the shared list: `remove` acts on
    // whatever workspace the context resolves, so a shared case would destroy
    // the workspace every other suite shares. Each adapter's test file covers
    // it against its own throwaway workspace.
  ]
}
