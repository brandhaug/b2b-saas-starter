import {
  type CreatedWebhookEndpoint,
  type WebhookEndpoint
} from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { type WebhookDelivery } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { type WorkspaceViewer } from '@/lib/permissions'
import { createServerFn } from '@tanstack/react-start'

import { expectOptionalString, expectRecord, expectString } from './input-shape'

/**
 * The webhook server functions, in a **client-safe** module.
 *
 * This file is statically imported by the webhooks route and the components
 * it renders, and the route tree ships to the browser — so everything at
 * this module's top level rides on every page. That is why the mutation
 * effects and the payload assembly (the capability service, the permission
 * helper, the page frame) live in `webhooks.effects.ts` and are reached only
 * through dynamic `import()` inside each handler: TanStack Start strips
 * handler bodies from the client build, so the effects graph never ships.
 * The validators are stripped the same way handler bodies are —
 * `.validator()` runs on the server only — so the plain shape checks below
 * are the server's first decode, a wire-shape gate that declares each fn's
 * input type without dragging the Effect Schema chunk onto the route tree,
 * while the strict schemas (event bounds, optional patch fields) decode
 * again in the effects file before anything runs.
 *
 * The behaviour itself is tested as the plain effects in the effects file
 * (`webhooks.test.ts` imports `webhooks.effects.ts` directly), driven with
 * fixture layers and fixture actors.
 */

/** Input shape of `createWebhookEndpointServerFn`, for its client stub. */
type CreateWebhookInput = {
  readonly workspaceSlug: string
  readonly url: string
  readonly events: ReadonlyArray<string>
}

type EndpointMutationInput = {
  readonly workspaceSlug: string
  readonly endpointId: string
}

type UpdateEndpointInput = {
  readonly workspaceSlug: string
  readonly endpointId: string
  readonly url?: string | undefined
  readonly events?: ReadonlyArray<string> | undefined
  readonly enabled?: boolean | undefined
}

type ReplayDeliveryInput = {
  readonly workspaceSlug: string
  readonly deliveryId: string
}

type WorkspaceWebhooksInput = {
  readonly workspaceSlug: string
}

/**
 * The server fns' validators, plain shape checks that run on the server only
 * (TanStack strips `.validator()` from the client build): they are the
 * server's first decode, a wire-shape gate, and the strict schemas — event
 * bounds, optional patch fields — decode again in `webhooks.effects.ts`.
 * The array and boolean probes live here beside `input-shape.ts`'s string
 * probes because only this module sends those shapes over the wire; these
 * probes ARE the I/O boundary, so `unknown` in and `throw` out is the
 * contract, the same exemption `pickOptionalStrings` carries (lib/utils.ts).
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, effect/noThrowStatement, effect/noNewError, unicorn/prefer-type-error
function isNonEmptyStringArray(value: unknown): value is ReadonlyArray<string> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.length > 0)
  )
}

function expectStringArray(
  record: Record<string, unknown>,
  key: string,
  label: string
): ReadonlyArray<string> {
  const value = record[key]
  if (!isNonEmptyStringArray(value)) {
    throw new Error(`Invalid ${label}: ${key}`)
  }
  return value
}

function expectOptionalStringArray(
  record: Record<string, unknown>,
  key: string,
  label: string
): ReadonlyArray<string> | undefined {
  return record[key] === undefined ? undefined : expectStringArray(record, key, label)
}

function expectOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
  label: string
): boolean | undefined {
  const value = record[key]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${label}: ${key}`)
  }
  return value
}

function decodeCreateInput(input: unknown): CreateWebhookInput {
  const record = expectRecord(input, 'webhook input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'webhook input'),
    url: expectString(record, 'url', 'webhook input'),
    events: expectStringArray(record, 'events', 'webhook input')
  }
}

function decodeEndpointMutation(input: unknown): EndpointMutationInput {
  const record = expectRecord(input, 'webhook input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'webhook input'),
    endpointId: expectString(record, 'endpointId', 'webhook input')
  }
}

function decodeUpdateEndpoint(input: unknown): UpdateEndpointInput {
  const record = expectRecord(input, 'webhook input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'webhook input'),
    endpointId: expectString(record, 'endpointId', 'webhook input'),
    url: expectOptionalString(record, 'url', 'webhook input'),
    events: expectOptionalStringArray(record, 'events', 'webhook input'),
    enabled: expectOptionalBoolean(record, 'enabled', 'webhook input')
  }
}

function decodeReplayDelivery(input: unknown): ReplayDeliveryInput {
  const record = expectRecord(input, 'webhook input')
  return {
    workspaceSlug: expectString(record, 'workspaceSlug', 'webhook input'),
    deliveryId: expectString(record, 'deliveryId', 'webhook input')
  }
}

function decodeWebhooksInput(input: unknown): WorkspaceWebhooksInput {
  const record = expectRecord(input, 'webhooks input')
  return { workspaceSlug: expectString(record, 'workspaceSlug', 'webhooks input') }
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, effect/noThrowStatement, effect/noNewError, unicorn/prefer-type-error

export const createWebhookEndpointServerFn = createServerFn({ method: 'POST' })
  .validator(decodeCreateInput)
  .handler(async ({ data }): Promise<CreatedWebhookEndpoint> => {
    const { createWebhookEndpointHandler } = await import('./webhooks.effects')
    return createWebhookEndpointHandler(data)
  })

/**
 * The webhooks payload.
 *
 * Like tokens, reading webhooks is itself a permission: `webhook:list` is
 * withheld from a plain `member`, so the page hard-gates on it — a member
 * meeting the URL directly gets the denial, not an empty list. Deliveries are
 * fetched per endpoint so each endpoint card can show its recent attempts.
 */
export type WorkspaceWebhooksPayload = {
  readonly viewer: WorkspaceViewer | null
  readonly unreadCount: number
  readonly endpoints: ReadonlyArray<
    WebhookEndpoint & {
      readonly deliveries: ReadonlyArray<WebhookDelivery>
    }
  >
}

/**
 * The webhooks route's loader. `webhook:list` is the page's own read
 * permission and a hard gate.
 */
export const loadWorkspaceWebhooksServerFn = createServerFn({ method: 'GET' })
  .validator(decodeWebhooksInput)
  .handler(async ({ data }): Promise<WorkspaceWebhooksPayload> => {
    const { loadWorkspaceWebhooksHandler } = await import('./webhooks.effects')
    return loadWorkspaceWebhooksHandler(data)
  })

export const updateWebhookEndpointServerFn = createServerFn({ method: 'POST' })
  .validator(decodeUpdateEndpoint)
  .handler(async ({ data }): Promise<WebhookEndpoint> => {
    const { updateWebhookEndpointHandler } = await import('./webhooks.effects')
    return updateWebhookEndpointHandler(data)
  })

export const rotateWebhookSecretServerFn = createServerFn({ method: 'POST' })
  .validator(decodeEndpointMutation)
  .handler(async ({ data }): Promise<string> => {
    const { rotateWebhookSecretHandler } = await import('./webhooks.effects')
    return rotateWebhookSecretHandler(data)
  })

export const replayWebhookDeliveryServerFn = createServerFn({ method: 'POST' })
  .validator(decodeReplayDelivery)
  .handler(async ({ data }): Promise<{ readonly deliveryId: string }> => {
    const { replayWebhookDeliveryHandler } = await import('./webhooks.effects')
    return replayWebhookDeliveryHandler(data)
  })

export const sendTestEventServerFn = createServerFn({ method: 'POST' })
  .validator(decodeEndpointMutation)
  .handler(async ({ data }): Promise<{ readonly deliveryId: string }> => {
    const { sendTestEventHandler } = await import('./webhooks.effects')
    return sendTestEventHandler(data)
  })
