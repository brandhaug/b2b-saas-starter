import {
  readPluginBindingFailure,
  type PluginBindingFailure
} from '@b2b-saas-starter/capabilities/governance/plugin-binding-failure'
import { describe, expect, it } from 'vite-plus/test'
import { Option, Schema } from 'effect'

import { webWorkspaceLifecycleBinding } from './workspace-binding'

/**
 * The adapter's one behaviour that does not need Better Auth: what it does
 * with no in-flight request to take session headers from. Mirrors
 * `invitation-binding.test.ts` — rename and delete are `requireHeaders: true`
 * on the plugin, so a call with no request must land on the "unreachable"
 * side of the classifier, never the "refused" side.
 *
 * `create` is deliberately absent: it runs headerless by design, so its
 * headerless branch is the happy path, not this failure mode.
 */

const TaggedRejection = Schema.Struct({ _tag: Schema.String })
const decodeTag = Schema.decodeUnknownOption(TaggedRejection)

type BindingRejection = {
  readonly tag: string
  readonly failure: PluginBindingFailure
}

async function rejectionOf(call: () => Promise<void>): Promise<BindingRejection> {
  try {
    await call()
    return { tag: 'resolved', failure: { refusedByWorkspace: false, reason: 'none' } }
  } catch (error) {
    return {
      tag: Option.match(decodeTag(error), {
        onNone: () => 'untagged',
        onSome: (rejection) => rejection._tag
      }),
      failure: readPluginBindingFailure(error)
    }
  }
}

describe('webWorkspaceLifecycleBinding with no request', () => {
  it('rejects rename as unavailable rather than refused', async () => {
    expect(
      await rejectionOf(() =>
        webWorkspaceLifecycleBinding.rename({
          workspaceId: 'wrk_1',
          name: 'New Name'
        })
      )
    ).toEqual({
      tag: 'MissingRequestHeaders',
      failure: { refusedByWorkspace: false, reason: 'no_request_headers' }
    })
  })

  it('rejects remove as unavailable rather than refused', async () => {
    expect(
      await rejectionOf(() =>
        webWorkspaceLifecycleBinding.remove({ workspaceId: 'wrk_1' })
      )
    ).toEqual({
      tag: 'MissingRequestHeaders',
      failure: { refusedByWorkspace: false, reason: 'no_request_headers' }
    })
  })

  it('does not demand headers for create', async () => {
    // Without a request the call proceeds past the header check — it fails
    // later, on the missing local D1 binding (no database in the test
    // environment), never on MissingRequestHeaders.
    const outcome = await rejectionOf(() =>
      webWorkspaceLifecycleBinding.create({
        name: 'Headerless Labs',
        slug: 'headerless-labs',
        userId: 'usr_1'
      })
    )
    expect(outcome.tag).toBe('MissingD1Binding')
  })
})
