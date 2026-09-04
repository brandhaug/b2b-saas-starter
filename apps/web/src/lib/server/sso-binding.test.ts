import {
  readPluginBindingFailure,
  type PluginBindingFailure
} from '@b2b-saas-starter/capabilities/governance/plugin-binding-failure'
import { describe, expect, it } from 'vite-plus/test'
import { Option, Schema } from 'effect'

import { webSsoBinding } from './sso-binding'

/**
 * The adapter's one behaviour that does not need Better Auth: what it does
 * with no in-flight request to take session headers from — the
 * `invitation-binding.test.ts` contract, applied to the `sso` plugin's
 * session-gated endpoints. The rejection has to reach the capability as
 * "the store is unreachable", never as "the workspace refused".
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
    return {
      tag: 'resolved',
      failure: { refusedByWorkspace: false, reason: 'none' }
    }
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

const INPUT = {
  workspaceId: 'wrk_starter',
  providerId: 'sso_x',
  protocol: 'oidc',
  domain: 'acme.com',
  issuer: 'https://login.acme.com',
  clientId: 'client-abcd',
  clientSecret: 'sekrit',
  endpoints: {
    authorizationEndpoint: 'https://login.acme.com/authorize',
    tokenEndpoint: 'https://login.acme.com/token',
    jwksEndpoint: 'https://login.acme.com/jwks'
  },
  defaultWorkspaceRole: 'member'
} satisfies Parameters<typeof webSsoBinding.create>[0]

describe('webSsoBinding with no in-flight request', () => {
  it.each([
    {
      name: 'create classifies as unavailable',
      call: () => webSsoBinding.create(INPUT)
    },
    {
      name: 'update classifies as unavailable',
      call: () =>
        webSsoBinding.update({
          providerId: 'sso_x',
          enabled: true
        })
    },
    {
      name: 'remove classifies as unavailable',
      call: () => webSsoBinding.remove({ providerId: 'sso_x' })
    }
  ])('$name', async ({ call }) => {
    const rejection = await rejectionOf(call)
    expect(rejection.tag).toBe('MissingRequestHeaders')
    expect(rejection.failure.refusedByWorkspace).toBe(false)
  })
})
