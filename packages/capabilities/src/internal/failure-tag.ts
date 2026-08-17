import { Cause, Exit, Option, Schema } from 'effect'

/**
 * A `Cause`'s failure value carries no static type once it reaches a contract
 * case — the cases run against both adapters and assert only on the tag. The
 * schema names the one field they read, so the "is this a tagged error?"
 * question is a decode rather than a hand-written probe.
 */
const TaggedError = Schema.Struct({ _tag: Schema.String })

const decodeTaggedError = Schema.decodeUnknownOption(TaggedError)

/**
 * The failing tag of an exit, or `undefined` if it succeeded. Asserted through
 * `Exit` rather than `Effect.flip`, which would move the success type into the
 * error channel and widen every case's signature.
 *
 * Shared by `workspace-membership.contract.ts` and
 * `workspace-invitations.contract.ts`, which assert the same way.
 */
export function failureTag(outcome: Exit.Exit<unknown, unknown>): string | undefined {
  if (Exit.isSuccess(outcome)) return undefined
  const error = Cause.findErrorOption(outcome.cause)
  if (Option.isNone(error)) return undefined
  const tagged = decodeTaggedError(error.value)
  if (Option.isNone(tagged)) return undefined
  return tagged.value._tag
}
