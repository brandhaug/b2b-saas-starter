import { Effect, Option, Schema } from 'effect'

import { CapabilityUnavailable } from '../errors.ts'

/**
 * The only shape this starter reads off a rejected Better Auth plugin call.
 *
 * The plugin rejects with its `APIError`, which carries a numeric `statusCode`.
 * A network blow-up, a thrown `TypeError` from the adapter, or anything else
 * rejects with a value that has no such field. Decoding that difference here —
 * once, against a schema — keeps the "is this an APIError?" question out of the
 * capabilities, which otherwise each probe the value by hand.
 */
const PluginRejection = Schema.Struct({
  statusCode: Schema.Number
})

const decodePluginRejection = Schema.decodeUnknownOption(PluginRejection)

/**
 * How a rejected binding call should be classified.
 *
 * `refusedByWorkspace` means the workspace declined the change on its merits —
 * an unknown user, an address that is already a member, a role it will not
 * accept. Everything else is the store failing. Getting this backwards tells a
 * caller to retry a request that can never succeed.
 */
export type PluginBindingFailure = {
  readonly refusedByWorkspace: boolean
  readonly reason: string
}

/** The message to carry into the typed error, whatever was thrown. */
function reasonOf(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message
  }
  return String(cause)
}

export function readPluginBindingFailure(cause: unknown): PluginBindingFailure {
  const rejection = decodePluginRejection(cause)
  if (Option.isNone(rejection)) {
    return { refusedByWorkspace: false, reason: reasonOf(cause) }
  }
  const { statusCode } = rejection.value
  return {
    refusedByWorkspace: statusCode >= 400 && statusCode < 500,
    reason: reasonOf(cause)
  }
}

/**
 * The shared shape of the governance Live adapters' plugin calls, built once
 * per capability: the "no binding wired" error and a `callBinding` wrapper
 * that classifies rejections through `readPluginBindingFailure`. A 4xx means
 * the workspace declined the change on its merits — the caller's `Rejected`
 * error — while anything else is the store failing (`CapabilityUnavailable`).
 */
export function makeBindingCaller<Binding, RejectedError>(options: {
  readonly capability: string
  readonly noBindingReason: string
  readonly Rejected: new (args: { reason: string }) => RejectedError
}) {
  const noBinding = new CapabilityUnavailable({
    capability: options.capability,
    reason: options.noBindingReason
  })

  function classifyBindingFailure(
    cause: unknown
  ): CapabilityUnavailable | RejectedError {
    const failure = readPluginBindingFailure(cause)
    if (failure.refusedByWorkspace) {
      return new options.Rejected({ reason: failure.reason })
    }
    return new CapabilityUnavailable({
      capability: options.capability,
      reason: failure.reason
    })
  }

  /** Fails with `noBinding` when unset, else runs the call through the classifier. */
  function callBinding(
    binding: Binding | undefined,
    call: (bound: Binding) => Promise<void>
  ) {
    if (!binding) {
      return Effect.fail(noBinding)
    }
    return Effect.tryPromise({
      try: () => call(binding),
      catch: classifyBindingFailure
    })
  }

  return { noBinding, callBinding }
}
