import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { Option, Schema } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { guardFailureResponse, RateLimited, Unauthorized } from './errors.ts'

/**
 * The `/mcp` guard-failure statuses are a literal table beside the
 * `httpApiStatus` annotations that serve the REST surface. That table is
 * deliberately dumb — but it is a second copy of four numbers, so this test
 * is what makes "same status as REST" an enforced invariant instead of a
 * comment: each row must equal the annotation `HttpApiBuilder` itself reads.
 * Annotations are an open `unknown` bag, so the status is decoded rather
 * than read on faith; a class that lost its annotation fails the row.
 */
const StatusAnnotation = Schema.Struct({ httpApiStatus: Schema.Number })
const decodeStatusAnnotation = Schema.decodeUnknownOption(StatusAnnotation)

function annotatedStatus(schema: Schema.Top): number {
  const decoded = decodeStatusAnnotation(schema.ast.annotations)
  if (Option.isNone(decoded)) {
    throw new Error(`no httpApiStatus annotation on ${String(schema.ast)})`)
  }
  return decoded.value.httpApiStatus
}

describe('guardFailureResponse', () => {
  // One row per member of `GuardFailure` (Unauthorized, AuthorizationDenied,
  // RateLimited, CapabilityUnavailable): a failure added to the union without
  // a table row is already a compile error (`satisfies` keys the table by the
  // union's tags); this adds the value half of the guarantee. A new union
  // member adds a case here with it.
  const cases = [
    {
      failure: new Unauthorized({ message: 'no bearer token' }),
      schema: Unauthorized
    },
    {
      failure: new AuthorizationDenied({ reason: 'insufficient_permission' }),
      schema: AuthorizationDenied
    },
    {
      failure: new RateLimited({ bucket: 'write' }),
      schema: RateLimited
    },
    {
      failure: new CapabilityUnavailable({
        capability: 'test',
        reason: 'store unreachable'
      }),
      schema: CapabilityUnavailable
    }
  ]

  it('answers every guard failure with its schema’s REST status', () => {
    for (const { failure, schema } of cases) {
      expect(guardFailureResponse(failure).status).toBe(annotatedStatus(schema))
    }
  })
})
