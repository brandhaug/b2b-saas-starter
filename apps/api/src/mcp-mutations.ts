import {
  CreateApiTokenPayload,
  ReplaceApiTokenPayload
} from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import {
  CreateWebhookEndpointPayload,
  UpdateWebhookEndpointPayload
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { Effect, Schema, type Scope } from 'effect'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import {
  MUTATION_OPERATIONS,
  type CapabilityMutationError,
  type CapabilityMutationServices,
  type OperationOrigin,
  type OperationExportRecipient,
  type OperationPrincipal
} from './operations.ts'

type MutationInvocation = Effect.Effect<
  unknown,
  CapabilityMutationError,
  | CapabilityMutationServices
  | WorkspaceContext
  | OperationOrigin
  | OperationExportRecipient
  | OperationPrincipal
  | Scope.Scope
>

/** JSON arguments are decoded before a typed adapter calls the shared operation. */
function projection<S extends Schema.Constraint, Options>(
  operation: {
    readonly endpoint: (typeof MUTATION_OPERATIONS)[keyof typeof MUTATION_OPERATIONS]['endpoint']
    readonly permission: (typeof MUTATION_OPERATIONS)[keyof typeof MUTATION_OPERATIONS]['permission']
    readonly run: (options: Options) => MutationInvocation
  },
  input: S,
  adapt: (input: S['Type']) => NoInfer<Options>,
  metadata: {
    readonly toolName: string
    readonly toolDescription: string
    readonly annotations: {
      readonly readOnlyHint: false
      readonly destructiveHint: boolean
      readonly idempotentHint: boolean
      readonly openWorldHint: boolean
    }
  }
) {
  return {
    endpoint: operation.endpoint,
    permission: operation.permission,
    input,
    decode: (payload: Schema.Json) =>
      Schema.decodeUnknownEffect(input)(payload).pipe(
        Effect.map((args) => Effect.suspend(() => operation.run(adapt(args))))
      ),
    ...metadata
  }
}

const endpointInput = Schema.Struct({ endpointId: Schema.String })

/** Exhaustive over the catalog: removing a projection leaves a type error. */
const projections = {
  'api-tokens.create': projection(
    MUTATION_OPERATIONS['api-tokens.create'],
    CreateApiTokenPayload,
    (payload) => ({ params: {}, payload }),
    {
      toolName: 'create_api_token',
      toolDescription:
        'Create a scoped API token. Returns the plaintext token once; store it securely. Records an audit event and may publish webhooks.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    }
  ),
  'api-tokens.replace': projection(
    MUTATION_OPERATIONS['api-tokens.replace'],
    Schema.Struct({ tokenId: Schema.String, ...ReplaceApiTokenPayload.fields }),
    ({ tokenId, ...payload }) => ({ params: { tokenId }, payload }),
    {
      toolName: 'replace_api_token',
      toolDescription:
        'Replace an active API token with the same or fewer scopes and no later expiry. Return the new plaintext token once. Retire the old credential immediately or after up to 24 hours of overlap. Records an audit event; do not retry automatically.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    }
  ),
  'api-tokens.delete': projection(
    MUTATION_OPERATIONS['api-tokens.delete'],
    Schema.Struct({ tokenId: Schema.String }),
    (args) => ({ params: args }),
    {
      toolName: 'delete_api_token',
      toolDescription:
        'Revoke an API token. Unknown or already revoked IDs also return revoked. Records an audit event and may publish webhooks only when a token is revoked.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    }
  ),
  'webhooks.create': projection(
    MUTATION_OPERATIONS['webhooks.create'],
    CreateWebhookEndpointPayload,
    (payload) => ({ params: {}, payload }),
    {
      toolName: 'create_webhook',
      toolDescription:
        'Register a webhook endpoint, subject to URL validation and plan limits. Audits and may publish webhooks. Returns endpoint metadata only; use rotate_webhook_secret to obtain a signing secret.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    }
  ),
  'webhooks.update': projection(
    MUTATION_OPERATIONS['webhooks.update'],
    Schema.Struct({
      endpointId: Schema.String,
      ...UpdateWebhookEndpointPayload.fields
    }),
    ({ endpointId, ...payload }) => ({ params: { endpointId }, payload }),
    {
      toolName: 'update_webhook',
      toolDescription:
        'Change a webhook URL, event subscriptions or enabled state. Records an audit event. URL changes undergo SSRF validation.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    }
  ),
  'webhooks.delete': projection(
    MUTATION_OPERATIONS['webhooks.delete'],
    endpointInput,
    (args) => ({ params: args }),
    {
      toolName: 'delete_webhook',
      toolDescription:
        'Delete a webhook endpoint and its associated data. Records an audit event. Missing endpoints are refused.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    }
  ),
  'webhooks.rotate-secret': projection(
    MUTATION_OPERATIONS['webhooks.rotate-secret'],
    endpointInput,
    (args) => ({ params: args }),
    {
      toolName: 'rotate_webhook_secret',
      toolDescription:
        'Rotate a webhook signing secret and return the new secret once. The previous secret remains active for 24 hours. Records an audit event.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true
      }
    }
  ),
  'webhooks.test-event': projection(
    MUTATION_OPERATIONS['webhooks.test-event'],
    endpointInput,
    (args) => ({ params: args }),
    {
      toolName: 'send_webhook_test_event',
      toolDescription:
        'Create a test delivery and enqueue an external webhook send. Disabled or missing endpoints are refused. A queue failure may leave a pending delivery; do not retry automatically.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    }
  ),
  'webhooks.replay-delivery': projection(
    MUTATION_OPERATIONS['webhooks.replay-delivery'],
    Schema.Struct({ deliveryId: Schema.String }),
    (args) => ({ params: args }),
    {
      toolName: 'replay_webhook_delivery',
      toolDescription:
        'Create an audited pending copy of a terminal delivery and enqueue another external send. The original is preserved. A queue failure may leave the pending copy; do not retry automatically.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    }
  ),
  'workspace-exports.request': projection(
    MUTATION_OPERATIONS['workspace-exports.request'],
    Schema.Struct({}),
    () => ({ params: {} }),
    {
      toolName: 'request_workspace_export',
      toolDescription:
        'Request a workspace archive. Creates an audited export job, enqueues it, and notifies the requester when complete. Queue failure leaves a failed export. Do not retry automatically.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    }
  ),
  'workspace-exports.download-link': projection(
    MUTATION_OPERATIONS['workspace-exports.download-link'],
    Schema.Struct({ exportId: Schema.String }),
    (args) => ({ params: args }),
    {
      toolName: 'get_workspace_export_download_link',
      toolDescription:
        'Issue a signed download URL for a ready, unexpired workspace archive. Treat the URL as a secret. Expires within 15 minutes, capped by artifact retention. Unavailable exports are refused.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    }
  )
} satisfies Record<keyof typeof MUTATION_OPERATIONS, ReturnType<typeof projection>>

export function mcpMutationOperations() {
  return Object.values(projections)
}
