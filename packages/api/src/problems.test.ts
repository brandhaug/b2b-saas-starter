import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { WorkspaceSuspended } from '@b2b-saas-starter/capabilities/errors'
import { Schema } from 'effect'
import { OpenApi } from 'effect/http-api'
import { describe, expect, it } from 'vite-plus/test'
import { StarterApi } from './index.ts'
import { publicProblem } from './problems.ts'

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown))

describe('public problem contract', () => {
  it('redacts infrastructure reasons before encoding and decoding', () => {
    const codec = publicProblem(CapabilityUnavailable)
    const body = Schema.encodeSync(codec)(
      new CapabilityUnavailable({
        capability: 'database',
        reason: 'SQL failed with secret credential'
      })
    )
    expect(body).toMatchObject({
      type: 'urn:b2b-saas-starter:problem:CapabilityUnavailable',
      status: 503
    })
    expect(encodeJson(body)).not.toContain('secret credential')
    expect(Schema.decodeUnknownSync(codec)(body)).toBeInstanceOf(CapabilityUnavailable)
  })

  it('discriminates problems with the same status and retains safe extensions', () => {
    const denied = publicProblem(AuthorizationDenied)
    const suspended = publicProblem(WorkspaceSuspended)
    const codec = Schema.Union([denied, suspended])
    const body = Schema.encodeSync(codec)(
      new WorkspaceSuspended({ workspaceId: 'ws_test' })
    )
    expect(Schema.decodeUnknownSync(codec)(body)).toEqual(
      new WorkspaceSuspended({ workspaceId: 'ws_test' })
    )
    expect(() =>
      Schema.decodeUnknownSync(denied)({
        ...body,
        _tag: 'AuthorizationDenied',
        reason: 'insufficient_permission'
      })
    ).toThrow(/urn:/)
  })

  it('documents only problem JSON for every declared REST failure', () => {
    const document = OpenApi.fromApi(StarterApi)
    for (const path of Object.values(document.paths)) {
      for (const method of [
        'get',
        'post',
        'put',
        'patch',
        'delete',
        'head',
        'options'
      ] as const) {
        const operation = path[method]
        if (operation === undefined) {
          continue
        }
        for (const [status, response] of Object.entries(operation.responses)) {
          if (Number(status) < 400 || !('content' in response)) {
            continue
          }
          expect(Object.keys(response.content ?? {})).toEqual([
            'application/problem+json'
          ])
        }
      }
    }
  })
})
