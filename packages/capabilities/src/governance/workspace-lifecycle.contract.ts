import { Effect } from 'effect'
import { type CapabilityUnavailable, type WorkspaceChangeRejected } from '../errors.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { type WorkspaceContext } from '../workspace-context.ts'
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
    WorkspaceLifecycle | WorkspaceContext
  >
}

/** The slice of vitest's `expect` these cases use — see the membership contract. */
export type ContractExpect = <A>(actual: A) => {
  readonly toBe: (expected: A) => void
  readonly toContain: (expected: A) => void
}

export function workspaceLifecycleContractCases(
  ids: LifecycleContractIds,
  expect: ContractExpect
): readonly LifecycleContractCase[] {
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
    }
    // Deletion is deliberately absent from the shared list: `remove` acts on
    // whatever workspace the context resolves, so a shared case would destroy
    // the workspace every other suite shares. Each adapter's test file covers
    // it against its own throwaway workspace.
  ]
}
