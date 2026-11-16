import { type RateLimited, type Unauthorized } from '@b2b-saas-starter/api/errors'
import { Result } from 'effect'
import { CallToolResult } from 'effect/ai/McpSchema'
import { type CapabilityMutationError, type CapabilityReadError } from './operations.ts'

/**
 * Generic failure body shared by both defect seams (tool and resource);
 * internals never leak into the client's transcript.
 */
export const TOOL_FAILED_MESSAGE = 'tool failed; see the API worker logs'

/** What a settled tool invocation hands the wire encoder. */
type ToolFailure =
  | CapabilityReadError
  | CapabilityMutationError
  | RateLimited
  | Unauthorized
export type ToolOutcome = Result.Result<unknown, ToolFailure>

// The JSON-RPC wire format carries opaque JSON payloads; serializing the
// already-typed capability results here IS the encoding step. It never
// unwraps a `Redacted`: a tool that hands over a one-time secret reveals that
// one field itself (`revealing` in `mcp-mutations.ts`), so anything else stays
// `<redacted>`.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `unknown` is the protocol's own payload type; the capability layer already produced it
function textResult(data: unknown): CallToolResult {
  return new CallToolResult({
    // oxlint-disable-next-line effect/noGlobals -- see above: this is the wire encoding
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
  })
}

/**
 * The one text vocabulary for a typed capability failure. The tool channel
 * wraps it in an `isError` result and the resource channel in an internal
 * error, so both surfaces speak identically. The switch is exhaustive over
 * `CapabilityReadError`: a new variant is a compile error here until it gets
 * its text, never a silent generic body or a serialized failure object.
 */
export function failureText(error: ToolFailure): string {
  switch (error._tag) {
    case 'WorkspaceSuspended': {
      return 'WorkspaceSuspended: workspace access is suspended. Contact a workspace owner or administrator.'
    }
    case 'AuthorizationDenied': {
      return `denied: ${error.reason}`
    }
    case 'StrongAuthenticationRequired': {
      return 'denied: strong_authentication_required'
    }
    case 'CapabilityUnavailable': {
      if (error.capability === 'webhook-publisher') {
        return 'webhook queue unavailable; a pending delivery may have been saved, but enqueue was not confirmed. Inspect deliveries before retrying'
      }
      if (error.capability === 'workspace-exports') {
        return 'export unavailable; an enqueue failure may have saved a failed export'
      }
      return 'capability unavailable in this environment'
    }
    case 'Unauthorized': {
      return 'credential no longer valid'
    }
    case 'RateLimited': {
      return 'write rate limit exceeded'
    }
    case 'PlanLimitExceeded': {
      return 'workspace plan limit exceeded'
    }
    case 'InvalidApiTokenInput': {
      return 'invalid API token input'
    }
    case 'ApiTokenNotRotatable': {
      return 'API token cannot be replaced'
    }
    case 'InvalidWebhookUrl': {
      return 'invalid webhook URL'
    }
    case 'WebhookEndpointNotFound': {
      return 'webhook endpoint not found'
    }
    case 'WebhookDeliveryNotFound': {
      return 'webhook delivery not found'
    }
    case 'WebhookDispatchRejected': {
      return `webhook dispatch refused: ${error.reason}`
    }
    case 'WorkspaceExportNotDownloadable': {
      return 'workspace export not downloadable'
    }
    case 'WorkspaceNotFound': {
      return 'workspace not found'
    }
  }
}

/** Success as JSON text; a typed failure as text the model can read, `isError` set. */
export function outcomeToToolResult(outcome: ToolOutcome): CallToolResult {
  if (Result.isSuccess(outcome)) {
    return textResult(outcome.success)
  }
  if (outcome.failure._tag === 'WorkspaceSuspended') {
    return new CallToolResult({
      content: [{ type: 'text', text: failureText(outcome.failure) }],
      structuredContent: {
        _tag: 'WorkspaceSuspended',
        workspaceId: outcome.failure.workspaceId
      },
      isError: true
    })
  }
  return new CallToolResult({
    content: [{ type: 'text', text: failureText(outcome.failure) }],
    isError: true
  })
}
