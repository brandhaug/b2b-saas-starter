import {
  readPluginBindingFailure,
  type PluginBindingFailure
} from '@b2b-saas-starter/capabilities/src/governance/plugin-binding-failure.ts'
import { describe, expect, it } from 'vitest'
import { Option, Schema } from 'effect'

import { webMemberBinding } from './member-binding'

/**
 * The adapter's one behaviour that does not need Better Auth: what it does with
 * no in-flight request to take session headers from.
 *
 * `updateMemberRole` and `removeMember` are `requireHeaders: true`, so this is
 * not an edge case — it is the state a client-side navigation or a background
 * call is in. The rejection has to reach the capability as "the store is
 * unreachable", never as "the workspace refused", because nothing about the
 * membership is wrong. The assertion runs the capability's own classifier over
 * the rejected value rather than restating its rule, so a `statusCode` appearing
 * on this error — or the classifier changing its mind about a missing status —
 * fails here.
 *
 * Under Vitest there is no TanStack request storage, so `currentRequest()`
 * answers `undefined` and every headered call below takes that branch.
 *
 * `addMember` is deliberately absent from this file: the plugin's add-member
 * route runs headerless by design (`serverOnly`, no session middleware), so it
 * has no no-request branch to assert.
 */

const TaggedRejection = Schema.Struct({ _tag: Schema.String })
const decodeTag = Schema.decodeUnknownOption(TaggedRejection)

type BindingRejection = {
  /** `'resolved'` when the call did not reject at all, which is a failure here. */
  readonly tag: string
  readonly failure: PluginBindingFailure
}

async function rejectionOf(call: () => Promise<void>): Promise<BindingRejection> {
  // oxlint-disable-next-line effect/noTryCatch -- the port under test is a promise boundary by contract; catching the rejection IS the observation
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

type BindingCall = {
  readonly name: string
  readonly call: () => Promise<void>
}

const CALLS: readonly BindingCall[] = [
  {
    name: 'removeMember',
    call: () =>
      webMemberBinding.removeMember({ workspaceId: 'ws_1', memberId: 'mbr_1' })
  },
  {
    name: 'changeRole',
    call: () =>
      webMemberBinding.changeRole({
        workspaceId: 'ws_1',
        memberId: 'mbr_1',
        role: 'member'
      })
  }
]

describe('webMemberBinding with no request', () => {
  it.each(CALLS)(
    'rejects $name as unavailable rather than refused',
    async ({ call }) => {
      expect(await rejectionOf(call)).toEqual({
        tag: 'MissingRequestHeaders',
        failure: { refusedByWorkspace: false, reason: 'no_request_headers' }
      })
    }
  )
})
