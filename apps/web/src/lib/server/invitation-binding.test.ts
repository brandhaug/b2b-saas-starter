import {
  readPluginBindingFailure,
  type PluginBindingFailure
} from '@b2b-saas-starter/capabilities/governance/plugin-binding-failure'
import { describe, expect, it } from 'vitest'
import { Option, Schema } from 'effect'

import { webInvitationBinding } from './invitation-binding'

/**
 * The adapter's one behaviour that does not need Better Auth: what it does with
 * no in-flight request to take session headers from.
 *
 * Every endpoint it wraps is `requireHeaders: true`, so this is not an edge
 * case — it is the state a client-side navigation or a background call is in.
 * The rejection has to reach the capability as "the store is unreachable", never
 * as "the workspace refused", because nothing about the invitation is wrong. The
 * assertion runs the capability's own classifier over the rejected value rather
 * than restating its rule, so a `statusCode` appearing on this error — or the
 * classifier changing its mind about a missing status — fails here.
 *
 * Under Vitest there is no TanStack request storage, so `currentRequest()`
 * answers `undefined` and every call below takes that branch.
 */

const TaggedRejection = Schema.Struct({ _tag: Schema.String })
const decodeTag = Schema.decodeUnknownOption(TaggedRejection)

type BindingRejection = {
  /** `'resolved'` when the call did not reject at all, which is a failure here. */
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

type BindingCall = {
  readonly name: string
  readonly call: () => Promise<void>
}

const CALLS: ReadonlyArray<BindingCall> = [
  {
    name: 'create',
    call: () =>
      webInvitationBinding.create({
        workspaceId: 'ws_1',
        email: 'invitee@example.com',
        role: 'member'
      })
  },
  {
    name: 'cancel',
    call: () => webInvitationBinding.cancel({ invitationId: 'inv_1' })
  },
  {
    name: 'accept',
    call: () => webInvitationBinding.accept({ invitationId: 'inv_1' })
  }
]

describe('webInvitationBinding with no request', () => {
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
